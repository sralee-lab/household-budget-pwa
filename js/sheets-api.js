import { MONTH_TABS } from '../config.js';

const SPREADSHEETS_ENDPOINT = 'https://sheets.googleapis.com/v4/spreadsheets';

function authHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

// 결제수단은 "카드"/"현금" 같은 뭉뚱그린 이름이 아니라 "신한카드"처럼
// 구체적인 이름을 각자 자유롭게 등록하는 걸 전제로 한 예시 기본값이다.
export const DEFAULT_SETTINGS_VALUES = [
  ['Income Categories', 'Fixed Expense Categories', 'Variable Expense Categories', 'Payment Methods'],
  ['급여', '월세', '식비', '신한카드'],
  ['용돈', '구독료', '카페·간식', '현금'],
  ['부수입', '보험', '교통', '국민은행 계좌이체'],
  ['', '', '쇼핑', ''],
  ['', '', '의료', ''],
];

export async function getSheetTitles(accessToken, spreadsheetId) {
  const params = new URLSearchParams({ fields: 'sheets.properties.title' });
  const res = await fetch(`${SPREADSHEETS_ENDPOINT}/${spreadsheetId}?${params.toString()}`, {
    headers: authHeaders(accessToken),
  });
  if (!res.ok) throw new Error(`스프레드시트 조회 실패: ${res.status}`);
  const data = await res.json();
  return (data.sheets || []).map((s) => s.properties.title);
}

export async function readSettingsValues(accessToken, spreadsheetId) {
  const res = await fetch(
    `${SPREADSHEETS_ENDPOINT}/${spreadsheetId}/values/Settings!A1:D100`,
    { headers: authHeaders(accessToken) }
  );
  if (!res.ok) throw new Error(`Settings 읽기 실패: ${res.status}`);
  const data = await res.json();
  return data.values || null;
}

// 새 Settings 탭을 만들고 seedValues(없으면 기본 예시값)로 채운다.
export async function createSettingsSheet(accessToken, spreadsheetId, seedValues) {
  const addRes = await fetch(`${SPREADSHEETS_ENDPOINT}/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify({
      requests: [{ addSheet: { properties: { title: 'Settings' } } }],
    }),
  });
  if (!addRes.ok) throw new Error(`Settings 탭 생성 실패: ${addRes.status}`);

  const updateRes = await fetch(
    `${SPREADSHEETS_ENDPOINT}/${spreadsheetId}/values/Settings!A1?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ values: seedValues || DEFAULT_SETTINGS_VALUES }),
    }
  );
  if (!updateRes.ok) throw new Error(`Settings 값 입력 실패: ${updateRes.status}`);
}

// 지인이 이미 쓰던 시트를 연결하는 경우, Settings 탭이 이미 있으면 그대로
// 두고 없을 때만 새로 만든다 (기존 데이터를 건드리지 않기 위함).
export async function ensureSettingsSheet(accessToken, spreadsheetId) {
  const titles = await getSheetTitles(accessToken, spreadsheetId);
  if (!titles.includes('Settings')) {
    await createSettingsSheet(accessToken, spreadsheetId);
  }
}

// dateStr은 항상 로컬 날짜 기준 "YYYY-MM-DD" 문자열이어야 한다 (Date 객체를
// 넘기면 toISOString() 등에서 UTC로 변환되며 자정 근처(한국 기준 00~09시)
// 하루가 밀리는 버그가 생기므로, <input type="date"> 값처럼 이미 로컬
// 날짜 문자열인 값을 그대로 받는다).
export function monthTabFor(dateStr) {
  const month = Number(dateStr.slice(5, 7));
  return MONTH_TABS[month - 1];
}

// Spending 표는 각 월 탭의 A열이 아니라 L~P열에 있다(L:Date, M:Category,
// N:Pay. Method, O:Amount, P:Memo), 데이터는 4행부터 시작한다 — 실제 시트를
// 확인해 얻은 값(사용자가 시트에서 첫 빈 줄의 Date 셀이 L4임을 확인해줌).
// 새로 추가한 Currency 열은 그 바로 다음인 Q열에 둔다.
const SPENDING_RANGE_START = 'L4';
const SPENDING_RANGE_END = 'Q';

// Date | Category | Pay. Method | Amount | Memo | Currency 순서로 한 행을
// 해당 월 탭의 다음 빈 행에 추가한다. INSERT_ROWS를 쓰지 않고 OVERWRITE로
// 채워야 같은 행의 다른 박스(Overview/Credit card usage/Account management
// 등)가 밀리지 않는다.
export async function appendTransaction(accessToken, spreadsheetId, { dateStr, category, payMethod, amount, memo, currency }) {
  const tab = monthTabFor(dateStr);
  const range = encodeURIComponent(`'${tab}'!${SPENDING_RANGE_START}:${SPENDING_RANGE_END}`);
  const params = new URLSearchParams({
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'OVERWRITE',
  });
  const res = await fetch(
    `${SPREADSHEETS_ENDPOINT}/${spreadsheetId}/values/${range}:append?${params.toString()}`,
    {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({
        values: [[dateStr, category, payMethod, amount, memo, currency]],
      }),
    }
  );
  if (!res.ok) throw new Error(`거래 등록 실패: ${res.status}`);
  return res.json();
}
