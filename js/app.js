import { redirectToLogin, consumeTokenFromRedirect, getStoredToken, clearToken, fetchUserInfo } from './auth.js';

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

async function boot() {
  const redirectedToken = consumeTokenFromRedirect();
  const token = redirectedToken || getStoredToken();

  if (!token) {
    showScreen('login');
    return;
  }

  showScreen('loading');
  try {
    const userInfo = await fetchUserInfo(token.accessToken);
    document.getElementById('home-email').textContent = userInfo.email;
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
