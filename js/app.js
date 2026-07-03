import { redirectToLogin, consumeTokenFromRedirect, getStoredToken, clearToken, fetchUserInfo } from './auth.js';
import { findMySpreadsheet, findMostRecentSpreadsheet, copyTemplateForUser, spreadsheetEditUrl } from './drive-api.js';
import { createSettingsSheet, readSettingsValues, readSettings } from './sheets-api.js';
import { initQuickAdd, showOnboardingMessage, updateQuickAddSettings } from './quick-add.js';
import { showOnboardingChoice } from './onboarding.js';
import { getLinkedSheetId } from './local-store.js';
import { initSettings } from './settings.js';
import { initDashboard, reloadCurrentMonth } from './dashboard.js';
import { initEditTransaction } from './edit-transaction.js';

const screens = {
  login: document.getElementById('screen-login'),
  loading: document.getElementById('screen-loading'),
  onboarding: document.getElementById('screen-onboarding'),
  quickAdd: document.getElementById('screen-quick-add'),
  settings: document.getElementById('screen-settings'),
  dashboard: document.getElementById('screen-dashboard'),
  editTxn: document.getElementById('screen-edit-txn'),
};

// 로그인 완료 후 화면 전환(설정/대시보드 등)에 필요한 값들을 여기 보관한다.
const session = { accessToken: null, spreadsheetId: null, email: null, settings: null };

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

    session.accessToken = token.accessToken;
    session.spreadsheetId = file.id;
    session.email = userInfo.email;

    setLoadingMessage('설정 불러오는 중...');
    let settings = null;
    try {
      settings = await readSettings(token.accessToken, file.id);
    } catch (err) {
      settings = null;
    }
    session.settings = settings;

    showSheetLink(file.id);
    showScreen('quickAdd');
    initQuickAdd(token.accessToken, file.id, userInfo.email, settings);
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

document.getElementById('st-logout-btn').addEventListener('click', () => {
  clearToken();
  showScreen('login');
});

document.getElementById('nav-settings-btn').addEventListener('click', () => {
  showScreen('settings');
  initSettings(session.accessToken, session.spreadsheetId, session.email, (updatedSettings) => {
    session.settings = updatedSettings;
    updateQuickAddSettings(updatedSettings);
    showScreen('quickAdd');
  });
});

function openDashboard() {
  showScreen('dashboard');
  const settings = session.settings || { incomeCategories: [], defaultCurrency: 'KRW' };
  initDashboard(session.accessToken, session.spreadsheetId, settings, (txn) => {
    showScreen('editTxn');
    initEditTransaction(
      session.accessToken,
      session.spreadsheetId,
      settings,
      txn,
      () => {
        // 저장/삭제 완료 → 대시보드로 돌아가서 같은 달을 새로고침.
        showScreen('dashboard');
        reloadCurrentMonth();
      },
      () => {
        // 그냥 뒤로가기(저장 안 함).
        showScreen('dashboard');
      }
    );
  });
}

document.getElementById('nav-dashboard-btn').addEventListener('click', openDashboard);

document.getElementById('db-back-btn').addEventListener('click', () => {
  showScreen('quickAdd');
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

// 이미 홈 화면에 설치되어 standalone으로 실행 중이면 안 보여준다.
function initInstallHint() {
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (isStandalone) return;
  if (localStorage.getItem('hb_install_hint_dismissed')) return;

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const text = isIOS
    ? 'Safari 하단 공유 버튼을 누르고 "홈 화면에 추가"를 선택하면 앱처럼 설치돼요.'
    : '브라우저 메뉴에서 "홈 화면에 추가" 또는 "앱 설치"를 선택하면 앱처럼 설치돼요.';

  document.getElementById('install-hint-text').textContent = text;
  const hint = document.getElementById('install-hint');
  hint.hidden = false;

  document.getElementById('install-hint-dismiss').addEventListener('click', () => {
    hint.hidden = true;
    localStorage.setItem('hb_install_hint_dismissed', '1');
  });
}

initInstallHint();

boot();
