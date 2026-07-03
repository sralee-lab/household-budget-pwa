import { TEMPLATE_FILE_ID, APP_PROPERTY_KEY, APP_PROPERTY_VALUE, APP_PROPERTY_YEAR_KEY } from '../config.js';

const FILES_ENDPOINT = 'https://www.googleapis.com/drive/v3/files';

function authHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

// drive.file 스코프 하에서는 이 앱이 만든 파일만 검색 대상이 되므로,
// appProperties만으로 안전하게 "내 가계부 사본"을 찾을 수 있다.
export async function findMySpreadsheet(accessToken, year) {
  const q =
    `appProperties has { key='${APP_PROPERTY_KEY}' and value='${APP_PROPERTY_VALUE}' } ` +
    `and appProperties has { key='${APP_PROPERTY_YEAR_KEY}' and value='${year}' } ` +
    `and trashed = false`;
  const params = new URLSearchParams({ q, fields: 'files(id,name,appProperties)' });
  const res = await fetch(`${FILES_ENDPOINT}?${params.toString()}`, {
    headers: authHeaders(accessToken),
  });
  if (!res.ok) throw new Error(`Drive 조회 실패: ${res.status}`);
  const data = await res.json();
  return data.files[0] || null;
}

// 연도 필터 없이 이 앱이 만든 모든 사본을 찾는다. 올해 것이 없을 때, "완전
// 신규 사용자"인지 "예전 연도 파일이 있는 기존 사용자"인지 구분하는 데 쓴다.
// 가장 최근 연도(appProperties의 연도값 기준) 파일을 반환한다.
export async function findMostRecentSpreadsheet(accessToken) {
  const q = `appProperties has { key='${APP_PROPERTY_KEY}' and value='${APP_PROPERTY_VALUE}' } and trashed = false`;
  const params = new URLSearchParams({ q, fields: 'files(id,name,appProperties)' });
  const res = await fetch(`${FILES_ENDPOINT}?${params.toString()}`, {
    headers: authHeaders(accessToken),
  });
  if (!res.ok) throw new Error(`Drive 조회 실패: ${res.status}`);
  const data = await res.json();
  const files = data.files || [];
  if (files.length === 0) return null;

  files.sort((a, b) => {
    const yearA = Number((a.appProperties || {})[APP_PROPERTY_YEAR_KEY] || 0);
    const yearB = Number((b.appProperties || {})[APP_PROPERTY_YEAR_KEY] || 0);
    return yearB - yearA;
  });
  return files[0];
}

export async function copyTemplateForUser(accessToken, displayName, year) {
  const res = await fetch(`${FILES_ENDPOINT}/${TEMPLATE_FILE_ID}/copy`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify({
      name: `우리 집 가계부 ${year} - ${displayName}`,
      appProperties: {
        [APP_PROPERTY_KEY]: APP_PROPERTY_VALUE,
        [APP_PROPERTY_YEAR_KEY]: String(year),
      },
    }),
  });
  if (!res.ok) throw new Error(`템플릿 복사 실패: ${res.status}`);
  return res.json();
}

export function spreadsheetEditUrl(fileId) {
  return `https://docs.google.com/spreadsheets/d/${fileId}/edit`;
}

// 사용자가 붙여넣은 구글 시트 URL 또는 순수 ID에서 스프레드시트 ID를 뽑아낸다.
export function parseSpreadsheetId(input) {
  const trimmed = input.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  // URL이 아니라 ID를 직접 붙여넣은 경우로 간주.
  return trimmed;
}
