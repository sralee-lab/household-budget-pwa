import { MONTH_TABS, DEFAULT_CURRENCY } from '../config.js';
import { convertAmountWithRate } from './fx.js';

const SPREADSHEETS_ENDPOINT = 'https://sheets.googleapis.com/v4/spreadsheets';

function authHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

// Settings 탭 레이아웃(A1:P100, 헤더 1행 + 데이터 99행):
//   A/B/C: 수입/고정지출/변동지출 카테고리 (단순 세로 목록)
//   D: (사용 안 함 — 예전엔 결제수단 단순 목록이었음, 아래 마이그레이션 참고)
//   E2: 기본 통화(셀 하나)
//   F/G/H: 결제수단 표(이름/종류/연결계좌) — 같은 행끼리 한 결제수단의 속성.
//     G(종류)는 3단계(카드 모델)에서 채워질 자리라 지금은 항상 빈 칸.
//   I/J/K: 발급사/결제일/이용기간 시작일 — 3단계 전용, 지금은 항상 빈 칸.
//     (이번 단계에서 열만 만들어두면 3단계에서 구조를 또 안 바꿔도 된다.)
//   L: 여백(결제수단 표와 계좌 표 사이 시각적 구분용, 항상 빈 칸)
//   M/N/O/P: 계좌 표(이름/통화/시작잔액/현재잔액) — 계좌마다 통화가 다를 수
//     있어(예: 일본 계좌는 JPY) 기본 통화로 억지 환산하지 않고 계좌 고유
//     통화로 관리한다.
// 결제수단은 "카드"/"현금" 같은 뭉뚱그린 이름이 아니라 "신한카드"처럼
// 구체적인 이름을 각자 자유롭게 등록하는 걸 전제로 한 예시 기본값이다.
export const DEFAULT_SETTINGS_VALUES = [
  [
    'Income Categories', 'Fixed Expense Categories', 'Variable Expense Categories', '',
    'Default Currency', 'Payment Method Name', 'Payment Method Type', 'Linked Account',
    'Issuer', 'Billing Day', 'Billing Cycle Start', '',
    'Account Name', 'Account Currency', 'Starting Balance', 'Current Balance',
  ],
  ['급여', '월세', '식비', '', DEFAULT_CURRENCY, '신한카드', '', '', '', '', '', '', '', '', '', ''],
  ['용돈', '구독료', '카페·간식', '', '', '현금', '', '', '', '', '', '', '', '', '', ''],
  ['부수입', '보험', '교통', '', '', '국민은행 계좌이체', '', '', '', '', '', '', '', '', '', ''],
  ['', '', '쇼핑', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ['', '', '의료', '', '', '', '', '', '', '', '', '', '', '', '', ''],
];

const SETTINGS_RANGE = 'A1:P100';

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
    `${SPREADSHEETS_ENDPOINT}/${spreadsheetId}/values/Settings!${SETTINGS_RANGE}`,
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

// F/G/H(결제수단)나 M/N/O/P(계좌)처럼 "같은 행 = 한 레코드의 여러 속성"인
// 표를 파싱한다. columnValues()와 달리 각 열을 독립적으로 필터링하지
// 않는다 — 그러면 중간에 빈 칸(예: 아직 연결 계좌가 없는 결제수단)이 있는
// 열만 밀려서 다른 열과 행이 어긋나버리기 때문이다. 대신 "이름" 열이 채워진
// 행만 레코드로 인정하고, 그 행의 나머지 칸은 비어 있어도 그대로 들고 온다.
function extractRecords(dataRows, nameCol, otherCols) {
  const records = [];
  for (const row of dataRows) {
    const name = (row[nameCol] || '').toString().trim();
    if (!name) continue;
    const rec = { name };
    for (const key of Object.keys(otherCols)) {
      rec[key] = (row[otherCols[key]] || '').toString().trim();
    }
    records.push(rec);
  }
  return records;
}

// Settings 원본 2차원 배열을 앱이 쓰기 편한 구조화된 객체로 바꾼다.
export function parseSettings(rawValues) {
  const rows = rawValues || [];
  const dataRows = rows.slice(1);

  let paymentMethods = extractRecords(dataRows, 5, { type: 6, linkedAccount: 7 });
  if (paymentMethods.length === 0) {
    // 마이그레이션: 새 F열 결제수단 표가 비어 있는데 예전 D열(단순 목록)에
    // 값이 남아있으면, 이름만 그대로 옮겨온다(연결 계좌 등은 빈 값으로
    // 시작 — 사용자가 설정 화면에서 채우면 됨). 다음 저장부터는 D열이
    // 자동으로 비워지고 F/G/H가 정식 데이터가 된다.
    paymentMethods = columnValues(rows, 3).map((name) => ({ name, type: '', linkedAccount: '' }));
  }

  const accountRecords = extractRecords(dataRows, 12, { currency: 13, startingBalance: 14, currentBalance: 15 });
  const accounts = accountRecords.map((a) => {
    const startingBalance = Number(a.startingBalance || 0);
    return {
      name: a.name,
      currency: a.currency || DEFAULT_CURRENCY,
      startingBalance,
      currentBalance: a.currentBalance === '' ? startingBalance : Number(a.currentBalance),
    };
  });

  return {
    incomeCategories: columnValues(rows, 0),
    fixedExpenseCategories: columnValues(rows, 1),
    variableExpenseCategories: columnValues(rows, 2),
    defaultCurrency: (rows[1] && rows[1][4]) || DEFAULT_CURRENCY,
    paymentMethods,
    accounts,
  };
}

export async function readSettings(accessToken, spreadsheetId) {
  const raw = await readSettingsValues(accessToken, spreadsheetId);
  return parseSettings(raw);
}

// 구조화된 settings 객체를 다시 A1:P 그리드로 펼쳐서 통째로 덮어쓴다.
// values.update는 넘겨준 셀만 덮어쓸 뿐 범위 안의 나머지 셀은 그대로 두므로,
// 목록이 이전보다 짧아진 경우를 대비해 범위(100행) 전체를 빈 문자열로
// 패딩해서 보내야 예전에 남아있던 값이 지워진다. D열(예전 결제수단 목록)도
// 매번 빈 문자열로 채워 보내므로, 마이그레이션 후 첫 저장부터 자동으로
// 비워진다.
const SETTINGS_DATA_ROWS = 99; // 헤더 1행 + 데이터 99행 = A1:P100

export async function writeSettings(accessToken, spreadsheetId, settings) {
  const { incomeCategories, fixedExpenseCategories, variableExpenseCategories, defaultCurrency, paymentMethods, accounts } = settings;
  const values = [
    [
      'Income Categories', 'Fixed Expense Categories', 'Variable Expense Categories', '',
      'Default Currency', 'Payment Method Name', 'Payment Method Type', 'Linked Account',
      'Issuer', 'Billing Day', 'Billing Cycle Start', '',
      'Account Name', 'Account Currency', 'Starting Balance', 'Current Balance',
    ],
  ];
  for (let i = 0; i < SETTINGS_DATA_ROWS; i++) {
    const pm = paymentMethods[i];
    const acc = accounts[i];
    values.push([
      incomeCategories[i] || '',
      fixedExpenseCategories[i] || '',
      variableExpenseCategories[i] || '',
      '',
      i === 0 ? defaultCurrency : '',
      pm ? pm.name : '',
      pm ? (pm.type || '') : '',
      pm ? (pm.linkedAccount || '') : '',
      '', '', '', '',
      acc ? acc.name : '',
      acc ? (acc.currency || '') : '',
      acc ? String(acc.startingBalance ?? '') : '',
      acc ? String(acc.currentBalance ?? '') : '',
    ]);
  }

  const res = await fetch(
    `${SPREADSHEETS_ENDPOINT}/${spreadsheetId}/values/Settings!${SETTINGS_RANGE}?valueInputOption=RAW`,
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

// Spending 표는 각 월 탭의 A열이 아니라 L~R열에 있다(L:Date, M:Category,
// N:Pay. Method, O:Amount, P:Memo, Q:Currency, R:Account), 데이터는 4행부터
// 시작한다 — 실제 시트를 확인해 얻은 값(사용자가 시트에서 첫 빈 줄의 Date
// 셀이 L4임을 확인해줌). R열(계좌)은 이번 단계에서 추가 — 그 거래로 실제
// 차감/입금된 계좌 이름(연결 안 된 결제수단이면 빈 문자열).
const SPENDING_START_ROW = 4;
const SPENDING_RANGE_START = `L${SPENDING_START_ROW}`;
const SPENDING_RANGE_END = 'R';

// Google Sheets의 values.append(+insertDataOption=OVERWRITE)는 지정한 범위
// 안에서 "맨 위부터 연속으로 값이 있는 표"를 찾아 그 바로 다음 행에 쓴다 —
// 범위 전체의 진짜 마지막 행이 아니라 중간에 빈 행(gap)이 하나만 있어도 그
// 바로 다음 행에 덮어써버린다. deleteTransactionRow()는 행을 당기지 않고
// 값만 지우므로 삭제/이동된 거래가 하나라도 있으면 표 중간에 이런 gap이
// 생기고, 그 뒤로는 신규 등록이 gap 다음의 기존 거래를 조용히 덮어써
// "성공했다는데 시트엔 안 보이는" 버그로 이어진다. 그래서 append API 대신
// Date 열만 읽어 진짜 마지막 사용 행을 직접 계산한 뒤 values.update로 정확한
// 행에 쓴다.
async function findNextEmptyRow(accessToken, spreadsheetId, monthTab) {
  const range = encodeURIComponent(`'${monthTab}'!L${SPENDING_START_ROW}:L1008`);
  const params = new URLSearchParams({ valueRenderOption: 'UNFORMATTED_VALUE' });
  const res = await fetch(
    `${SPREADSHEETS_ENDPOINT}/${spreadsheetId}/values/${range}?${params.toString()}`,
    { headers: authHeaders(accessToken) }
  );
  if (!res.ok) throw new Error(`거래 내역 조회 실패: ${res.status}`);
  const data = await res.json();
  // 응답 배열은 항상 "진짜 마지막으로 값이 있는 행"까지만 오고(트레일링 빈
  // 행은 생략되지만 중간의 gap은 빈 배열 요소로 그대로 포함된다), 그래서
  // 길이만으로 gap 여부와 무관하게 정확한 다음 행을 구할 수 있다.
  const values = data.values || [];
  return SPENDING_START_ROW + values.length;
}

// Date | Category | Pay. Method | Amount | Memo | Currency | Account 순서로
// 한 행을 해당 월 탭의 다음 빈 행에 추가한다. 실제 행 삽입(INSERT_ROWS)은
// 쓰지 않는다 — 같은 행의 다른 박스(Overview/Credit card usage/Account
// management 등)가 밀리는 것을 방지하기 위함이다.
export async function appendTransaction(accessToken, spreadsheetId, { dateStr, category, payMethod, amount, memo, currency, account }) {
  const tab = monthTabFor(dateStr);
  const row = await findNextEmptyRow(accessToken, spreadsheetId, tab);
  const range = encodeURIComponent(`'${tab}'!L${row}:${SPENDING_RANGE_END}${row}`);
  const params = new URLSearchParams({ valueInputOption: 'USER_ENTERED' });
  const res = await fetch(
    `${SPREADSHEETS_ENDPOINT}/${spreadsheetId}/values/${range}?${params.toString()}`,
    {
      method: 'PUT',
      headers: authHeaders(accessToken),
      body: JSON.stringify({
        values: [[dateStr, category, payMethod, amount, memo, currency, account || '']],
      }),
    }
  );
  if (!res.ok) throw new Error(`거래 등록 실패: ${res.status}`);
  return res.json();
}

// 여러 건을 한 번에 등록한다 — 날짜가 다른 달에 걸쳐 있으면 월 탭별로 묶어서
// 탭당 다음 빈 행을 한 번만 계산하고, 그 탭에 속한 항목들을 이어지는 행
// 범위에 한 번의 values.update로 쓴다.
export async function appendTransactions(accessToken, spreadsheetId, transactions) {
  const byTab = new Map();
  for (const t of transactions) {
    const tab = monthTabFor(t.dateStr);
    if (!byTab.has(tab)) byTab.set(tab, []);
    byTab.get(tab).push([t.dateStr, t.category, t.payMethod, t.amount, t.memo, t.currency, t.account || '']);
  }

  for (const [tab, rows] of byTab) {
    const startRow = await findNextEmptyRow(accessToken, spreadsheetId, tab);
    const endRow = startRow + rows.length - 1;
    const range = encodeURIComponent(`'${tab}'!L${startRow}:${SPENDING_RANGE_END}${endRow}`);
    const params = new URLSearchParams({ valueInputOption: 'USER_ENTERED' });
    const res = await fetch(
      `${SPREADSHEETS_ENDPOINT}/${spreadsheetId}/values/${range}?${params.toString()}`,
      {
        method: 'PUT',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ values: rows }),
      }
    );
    if (!res.ok) throw new Error(`거래 등록 실패: ${res.status}`);
  }
}

// 구글 시트의 날짜 직렬값(1899-12-30 기준 경과 일수)을 로컬 "YYYY-MM-DD"
// 문자열로 바꾼다. 날짜 열을 FORMATTED_VALUE로 읽으면 셀 서식(예: M/D/YYYY)에
// 따라 형식이 달라져 파싱이 깨질 수 있어, UNFORMATTED_VALUE로 받은 직렬값을
// 직접 변환한다.
function serialDateToLocalStr(serial) {
  const epochUTC = Date.UTC(1899, 11, 30);
  const d = new Date(epochUTC + Math.round(serial) * 86400000);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// 한 달 탭의 Spending 표 전체를 읽어 거래 배열로 반환한다.
export async function readMonthLog(accessToken, spreadsheetId, monthTab) {
  const range = encodeURIComponent(`'${monthTab}'!${SPENDING_RANGE_START}:${SPENDING_RANGE_END}`);
  const params = new URLSearchParams({ valueRenderOption: 'UNFORMATTED_VALUE' });
  const res = await fetch(
    `${SPREADSHEETS_ENDPOINT}/${spreadsheetId}/values/${range}?${params.toString()}`,
    { headers: authHeaders(accessToken) }
  );
  if (!res.ok) throw new Error(`거래 내역 조회 실패: ${res.status}`);
  const data = await res.json();
  return (data.values || [])
    .map((row, index) => ({
      rowNumber: SPENDING_START_ROW + index,
      monthTab,
      dateStr: typeof row[0] === 'number' ? serialDateToLocalStr(row[0]) : '',
      category: row[1] || '',
      payMethod: row[2] || '',
      amount: Number(row[3] || 0),
      memo: row[4] || '',
      currency: row[5] || DEFAULT_CURRENCY,
      account: row[6] || '',
    }))
    .filter((row) => row.dateStr && row.amount);
}

// 특정 행 하나를 수정한다. 날짜를 다른 달로 바꾼 경우, 호출하는 쪽에서
// appendTransaction으로 새 달에 추가하고 이 함수 대신 deleteTransactionRow로
// 원래 행을 지우는 방식으로 처리해야 한다(이 함수는 같은 탭 안에서의
// 수정만 담당).
export async function updateTransactionRow(accessToken, spreadsheetId, monthTab, rowNumber, { dateStr, category, payMethod, amount, memo, currency, account }) {
  const range = encodeURIComponent(`'${monthTab}'!L${rowNumber}:${SPENDING_RANGE_END}${rowNumber}`);
  const params = new URLSearchParams({ valueInputOption: 'USER_ENTERED' });
  const res = await fetch(
    `${SPREADSHEETS_ENDPOINT}/${spreadsheetId}/values/${range}?${params.toString()}`,
    {
      method: 'PUT',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ values: [[dateStr, category, payMethod, amount, memo, currency, account || '']] }),
    }
  );
  if (!res.ok) throw new Error(`거래 수정 실패: ${res.status}`);
}

// 행을 삭제(실제로는 셀 값만 비움)한다. INSERT_ROWS/deleteDimension으로 실제
// 행을 옮기면 같은 행의 다른 박스가 밀리므로, 빈 줄로 남기는 쪽을 택한다.
export async function deleteTransactionRow(accessToken, spreadsheetId, monthTab, rowNumber) {
  const range = encodeURIComponent(`'${monthTab}'!L${rowNumber}:${SPENDING_RANGE_END}${rowNumber}`);
  const res = await fetch(
    `${SPREADSHEETS_ENDPOINT}/${spreadsheetId}/values/${range}:clear`,
    { method: 'POST', headers: authHeaders(accessToken) }
  );
  if (!res.ok) throw new Error(`거래 삭제 실패: ${res.status}`);
}

// 계좌 표(M/N/O/P)에서 accountName의 행 번호를 찾는다. writeSettings()가
// 항상 accounts 배열 순서대로 M2부터 빈틈없이 채워 쓰므로, "배열 인덱스 i =
// 시트 행 (2+i)"라는 대응이 항상 성립한다(설정 화면에서 추가/삭제할 때마다
// writeSettings()로 다시 패딩해 덮어쓰기 때문에 gap이 생기지 않는다).
function accountRowNumber(settings, accountName) {
  const idx = settings.accounts.findIndex((a) => a.name === accountName);
  return idx === -1 ? -1 : { idx, row: 2 + idx };
}

async function writeAccountCurrentBalance(accessToken, spreadsheetId, row, newBalance) {
  const range = encodeURIComponent(`Settings!P${row}`);
  const res = await fetch(
    `${SPREADSHEETS_ENDPOINT}/${spreadsheetId}/values/${range}?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ values: [[String(newBalance)]] }),
    }
  );
  if (!res.ok) throw new Error(`계좌 잔액 갱신 실패: ${res.status}`);
}

// 거래 등록/수정/삭제 때마다 호출해 연결 계좌의 현재 잔액을 증분 갱신한다.
// delta는 이미 그 계좌의 고유 통화로 환산된 금액이어야 한다(계좌 통화와
// 거래 통화가 다르면 호출하는 쪽에서 fx.js로 먼저 환산해서 넘길 것).
// settings.accounts도 같이 갱신해 같은 세션 안에서 최신 값을 바로 쓸 수
// 있게 한다.
export async function adjustAccountBalance(accessToken, spreadsheetId, settings, accountName, delta) {
  if (!accountName || !delta) return;
  const found = accountRowNumber(settings, accountName);
  if (found === -1) return;
  const { idx, row } = found;
  const newBalance = settings.accounts[idx].currentBalance + delta;
  settings.accounts[idx].currentBalance = newBalance;
  await writeAccountCurrentBalance(accessToken, spreadsheetId, row, newBalance);
}

// "다시 계산" 버튼용 — 사용자가 시트를 직접 고쳐 currentBalance가 실제
// 거래 합계와 어긋났을 때, 12개월 탭 전체를 다시 읽어 시작잔액부터
// 순변동을 다시 합산한다. 다른 통화 거래는 계좌 고유 통화로 환산해 반영.
export async function recalculateAccountBalance(accessToken, spreadsheetId, settings, accountName) {
  const found = accountRowNumber(settings, accountName);
  if (found === -1) return null;
  const { idx, row } = found;
  const account = settings.accounts[idx];
  const incomeCategories = settings.incomeCategories || [];

  let net = 0;
  for (const tab of MONTH_TABS) {
    const rows = await readMonthLog(accessToken, spreadsheetId, tab);
    for (const t of rows) {
      if (t.account !== accountName) continue;
      let amt = t.amount;
      if (t.currency !== account.currency) {
        try {
          const { convertedAmount } = await convertAmountWithRate(t.amount, t.currency, account.currency, t.dateStr);
          amt = convertedAmount;
        } catch (err) {
          // 환율 조회 실패 시 대시보드와 같은 원칙으로 액면가로 대체.
        }
      }
      const isIncome = incomeCategories.includes(t.category);
      net += isIncome ? amt : -amt;
    }
  }

  const newBalance = account.startingBalance + net;
  settings.accounts[idx].currentBalance = newBalance;
  await writeAccountCurrentBalance(accessToken, spreadsheetId, row, newBalance);
  return newBalance;
}
