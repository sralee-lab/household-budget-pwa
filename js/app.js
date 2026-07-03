import { redirectToLogin, consumeTokenFromRedirect, getStoredToken, clearToken, fetchUserInfo } from './auth.js';
import { findMySpreadsheet, findMostRecentSpreadsheet, copyTemplateForUser, spreadsheetEditUrl } from './drive-api.js';
import { createSettingsSheet, readSettingsValues } from './sheets-api.js';
import { initQuickAdd, showOnboardingMessage } from './quick-add.js';
import { showOnboardingChoice } from './onboarding.js';
import { getLinkedSheetId } from './local-store.js';

const screens = {
  login: document.getElementById('screen-login'),
  loading: document.getElementById('screen-loading'),
  onboarding: document.getElementById('screen-onboarding'),
  quickAdd: document.getElementById('screen-quick-add'),
};

function showScreen(name) {
  for (const [key, el] of Object.entries(screens)) {
    el.hidden = key !== name;
  }
}

function showLoginError(message) {
  const el = document.getElementById('login-error');
  el.textContent = message;
  el.hidden = !message;
}

function setLoadingMessage(message) {
  document.getElementById('loading-message').textContent = message;
}

function showSheetLink(fileId) {
  const link = document.getElementById('sheet-link');
  link.href = spreadsheetEditUrl(fileId);
  link.hidden = false;
}

// 올해 사본을 찾고, 없으면 "예전 연도 사본이 있는 기존 사용자(자동 롤오버)"인지
// "완전 신규 사용자(온보딩 선택 필요)"인지 구분해 스프레드시트를 확정한다.
// 반환값에 onboardingMessage가 있으면 화면에 안내 메시지를 띄운다.
async function resolveSpreadsheet(accessToken, email) {
  const year = new Date().getFullYear();

  const linkedId = getLinkedSheetId();
  if (linkedId) {
    return { file: { id: linkedId }, onboardingMessage: null };
  }

  setLoadingMessage('가계부 확인 중...');
  const thisYearFile = await findMySpreadsheet(accessToken, year);
  if (thisYearFile) {
    return { file: thisYearFile, onboardingMessage: null };
  }

  setLoadingMessage('예전 기록 확인 중...');
  const recentFile = await findMostRecentSpreadsheet(accessToken);
  if (recentFile) {
    setLoadingMessage(`${year}년 가계부를 새로 만드는 중이에요...`);
    let seedValues = null;
    try {
      seedValues = await readSettingsValues(accessToken, recentFile.id);
    } catch (err) {
      seedValues = null;
    }
    const newFile = await copyTemplateForUser(accessToken, email, year);
    await createSettingsSheet(accessToken, newFile.id, seedValues);
    return {
      file: newFile,
      onboardingMessage: `${year}년 가계부를 새로 만들었어요! (작년 설정을 그대로 이어받았어요)`,
    };
  }

  // 완전 신규 사용자 → 온보딩 선택 화면에서 사용자가 고를 때까지 대기.
  showScreen('onboarding');
  return new Promise((resolve) => {
    showOnboardingChoice({
      accessToken,
      onCreateNew: async () => {
        const file = await copyTemplateForUser(accessToken, email, year);
        await createSettingsSheet(accessToken, file.id);
        return file;
      },
      onResolved: (file) => {
        resolve({ file, onboardingMessage: null });
      },
    });
  });
}

async function boot() {
  const redirectedToken = consumeTokenFromRedirect();
  const token = redirectedToken || getStoredToken();

  if (!token) {
    showScreen('login');
    return;
  }

  showScreen('loading');
  setLoadingMessage('확인 중...');
  try {
    const userInfo = await fetchUserInfo(token.accessToken);
    const { file, onboardingMessage } = await resolveSpreadsheet(token.accessToken, userInfo.email);

    showSheetLink(file.id);
    showScreen('quickAdd');
    initQuickAdd(token.accessToken, file.id, userInfo.email);
    if (onboardingMessage) showOnboardingMessage(onboardingMessage);
  } catch (err) {
    clearToken();
    showScreen('login');
    showLoginError('로그인이 만료됐어요. 다시 로그인해주세요.');
  }
}

document.getElementById('login-btn').addEventListener('click', () => {
  document.getElementById('login-btn').disabled = true;
  redirectToLogin();
});

document.getElementById('logout-btn').addEventListener('click', () => {
  clearToken();
  showScreen('login');
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

boot();
