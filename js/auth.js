import { CLIENT_ID, SCOPES } from '../config.js';

const STORAGE_KEY = 'hb_token';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo';

function redirectUri() {
  return window.location.origin + window.location.pathname;
}

export function redirectToLogin() {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: 'token',
    scope: SCOPES,
    include_granted_scopes: 'true',
    prompt: 'select_account',
  });
  window.location.assign(`${AUTH_ENDPOINT}?${params.toString()}`);
}

// 리다이렉트로 돌아온 URL 프래그먼트(#access_token=...)에서 토큰을 읽어 저장한다.
// 프래그먼트가 없으면 null을 반환한다 (일반적인 재방문 케이스).
export function consumeTokenFromRedirect() {
  const hash = window.location.hash;
  if (!hash || !hash.includes('access_token')) return null;

  const params = new URLSearchParams(hash.slice(1));
  const accessToken = params.get('access_token');
  const expiresIn = Number(params.get('expires_in') || 0);
  const error = params.get('error');

  history.replaceState(null, '', window.location.pathname + window.location.search);

  if (error || !accessToken) return null;

  const token = {
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(token));
  return token;
}

export function getStoredToken() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  const token = JSON.parse(raw);
  if (Date.now() >= token.expiresAt) {
    clearToken();
    return null;
  }
  return token;
}

export function clearToken() {
  localStorage.removeItem(STORAGE_KEY);
}

export async function fetchUserInfo(accessToken) {
  const res = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    if (res.status === 401) clearToken();
    throw new Error(`userinfo 요청 실패: ${res.status}`);
  }
  return res.json();
}
