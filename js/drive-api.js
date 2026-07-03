import { TEMPLATE_FILE_ID, APP_PROPERTY_KEY, APP_PROPERTY_VALUE } from '../config.js';

const FILES_ENDPOINT = 'https://www.googleapis.com/drive/v3/files';

function authHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

// drive.file 스코프 하에서는 이 앱이 만든 파일만 검색 대상이 되므로,
// appProperties만으로 안전하게 "내 가계부 사본"을 찾을 수 있다.
export async function findMySpreadsheet(accessToken) {
  const q = `appProperties has { key='${APP_PROPERTY_KEY}' and value='${APP_PROPERTY_VALUE}' } and trashed = false`;
  const params = new URLSearchParams({ q, fields: 'files(id,name)' });
  const res = await fetch(`${FILES_ENDPOINT}?${params.toString()}`, {
    headers: authHeaders(accessToken),
  });
  if (!res.ok) throw new Error(`Drive 조회 실패: ${res.status}`);
  const data = await res.json();
  return data.files[0] || null;
}

export async function copyTemplateForUser(accessToken, displayName) {
  const res = await fetch(`${FILES_ENDPOINT}/${TEMPLATE_FILE_ID}/copy`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify({
      name: `우리 집 가계부 - ${displayName}`,
      appProperties: { [APP_PROPERTY_KEY]: APP_PROPERTY_VALUE },
    }),
  });
  if (!res.ok) throw new Error(`템플릿 복사 실패: ${res.status}`);
  return res.json();
}

export function spreadsheetEditUrl(fileId) {
  return `https://docs.google.com/spreadsheets/d/${fileId}/edit`;
}
