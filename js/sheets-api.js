import { MONTH_TABS, DEFAULT_CURRENCY } from '../config.js';

const SPREADSHEETS_ENDPOINT = 'https://sheets.googleapis.com/v4/spreadsheets';

function authHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

// 결제수단은 "카드"/"현금" 같은 뭉뚱그린 이름이 아니라 "신한카드"처럼
// 구체적인 이름을 각자 자유롭게 등록하는 걸 전제로 한 예시 기본값이다.
// E열은 기본 통화 하나만 담는 별도 칸(E2)이다.
export const DEFAULT_SETTINGS_VALUES = [
  ['Income Categories', 'Fixed Expense Categories', 'Variable Expense Categories', 'Payment Methods', 'Default Currency'],
  ['급여', '월세', '식비', '신한카드', DEFAULT_CURRENCY],
  ['용돈', '구독료', '카페·간식', '현금', ''],
  ['부수입', '보험', '교통', '국민은행 계좌이체', ''],
  ['', '', '쇼핑', '', ''],
  ['', '', '의료', '', ''],
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
    `${SPREADSHEETS_ENDPOINT}/${spreadsheetId}/values/Settings!A1:E100`,
    { headers: authHeaders(accessToken) }
  );
  if (!res.ok) throw new Error(`Settings 읽기 실패: ${res.status}`);
  const data = await res.json();
  return data.values || null;
}

function columnValues(rawValues, columnIndex) {
  return (rawValues || [])
    .slice(1) // 헤더 행 제외
    .map((row) => (row[columnIndex] || '').trim())
    .filter((v) => v !== '');
}

// Settings 원본 2차원 배열을 앱이 쓰기 편한 구조화된 객체로 바꾼다.
export function parseSettings(rawValues) {
  return {
    incomeCategories: columnValues(rawValues, 0),
    fixedExpenseCategories: columnValues(rawValues, 1),
    variableExpenseCategories: columnValues(rawValues, 2),
    paymentMethods: columnValues(rawValues, 3),
    defaultCurrency: (rawValues && rawValues[1] && rawValues[1][4]) || DEFAULT_CURRENCY,
  };
}

export async function readSettings(accessToken, spreadsheetId) {
  const raw = await readSettingsValues(accessToken, spreadsheetId);
  return parseSettings(raw);
}

// 구조화된 settings 객체를 다시 A1:E 그리드로 펼쳐서 통째로 덮어쓴다.
// values.update는 넘겨준 셀만 덮어쓸 뿐 범위 안의 나머지 셀은 그대로 두므로,
// 목록이 이전보다 짧아진 경우를 대비해 범위(100행) 전체를 빈 문자열로
// 패딩해서 보내야 예전에 남아있던 값이 지워진다.
const SETTINGS_DATA_ROWS = 99; // 헤더 1행 + 데이터 99행 = A1:E100

export async function writeSettings(accessToken, spreadsheetId, settings) {
  const { incomeCategories, fixedExpenseCategories, variableExpenseCategories, paymentMethods, defaultCurrency } = settings;
  const values = [
    ['Income Categories', 'Fixed Expense Categories', 'Variable Expense Categories', 'Payment Methods', 'Default Currency'],
  ];
  for (let i = 0; i < SETTINGS_DATA_ROWS; i++) {
    values.push([
      incomeCategories[i] || '',
      fixedExpenseCategories[i] || '',
      variableExpenseCategories[i] || '',
      paymentMethods[i] || '',
      i === 0 ? defaultCurrency : '',
    ]);
  }

  const res = await fetch(
    `${SPREADSHEETS_ENDPOINT}/${spreadsheetId}/values/Settings!A1:E100?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ values }),
    }
  );
  if (!res.ok) throw new Error(`Settings 저장 실패: ${res.status}`);
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

// 여러 건을 한 번에 등록한다 — 날짜가 다른 달에 걸쳐 있으면 월 탭별로
// 묶어서 탭당 한 번씩 append 호출한다(같은 탭이면 한 번의 호출로 끝난다).
export async function appendTransactions(accessToken, spreadsheetId, transactions) {
  const byTab = new Map();
  for (const t of transactions) {
    const tab = monthTabFor(t.dateStr);
    if (!byTab.has(tab)) byTab.set(tab, []);
    byTab.get(tab).push([t.dateStr, t.category, t.payMethod, t.amount, t.memo, t.currency]);
  }

  const range = (tab) => encodeURIComponent(`'${tab}'!${SPENDING_RANGE_START}:${SPENDING_RANGE_END}`);
  const params = new URLSearchParams({
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'OVERWRITE',
  });

  for (const [tab, rows] of byTab) {
    const res = await fetch(
      `${SPREADSHEETS_ENDPOINT}/${spreadsheetId}/values/${range(tab)}:append?${params.toString()}`,
      {
        method: 'POST',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ values: rows }),
      }
    );
    if (!res.ok) throw new Error(`거래 등록 실패: ${res.status}`);
  }
}
