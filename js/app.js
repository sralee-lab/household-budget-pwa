import { redirectToLogin, consumeTokenFromRedirect, getStoredToken, clearToken, fetchUserInfo } from './auth.js';
import { findMySpreadsheet, copyTemplateForUser, spreadsheetEditUrl } from './drive-api.js';
import { createSettingsSheet } from './sheets-api.js';

const screens = {
  login: document.getElementById('screen-login'),
  loading: document.getElementById('screen-loading'),
  home: document.getElementById('screen-home'),
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
    document.getElementById('home-email').textContent = userInfo.email;

    setLoadingMessage('가계부 확인 중...');
    let file = await findMySpreadsheet(token.accessToken);

    if (file) {
      document.getElementById('home-status').textContent = '가계부를 찾았어요';
    } else {
      setLoadingMessage('가계부를 처음 만드는 중이에요...');
      file = await copyTemplateForUser(token.accessToken, userInfo.email);
      await createSettingsSheet(token.accessToken, file.id);
      document.getElementById('home-status').textContent = '가계부를 새로 만들었어요!';
    }

    showSheetLink(file.id);
    showScreen('home');
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
