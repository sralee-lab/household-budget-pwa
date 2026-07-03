import { MONTH_TABS } from '../config.js';

const SPREADSHEETS_ENDPOINT = 'https://sheets.googleapis.com/v4/spreadsheets';

function authHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

// 새로 복사된 사본에 카테고리·결제수단·기본 통화를 담는 Settings 탭을 만들고
// 원본 템플릿과 같은 이름으로 기본값을 채운다.
export async function createSettingsSheet(accessToken, spreadsheetId) {
  const addRes = await fetch(`${SPREADSHEETS_ENDPOINT}/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify({
      requests: [{ addSheet: { properties: { title: 'Settings' } } }],
    }),
  });
  if (!addRes.ok) throw new Error(`Settings 탭 생성 실패: ${addRes.status}`);

  const values = [
    ['Income Categories', 'Fixed Expense Categories', 'Variable Expense Categories', 'Payment Methods'],
    ['급여', '월세', '식비', '카드'],
    ['용돈', '구독료', '카페·간식', '현금'],
    ['부수입', '보험', '교통', '계좌이체'],
    ['', '', '쇼핑', ''],
    ['', '', '의료', ''],
  ];
  const updateRes = await fetch(
    `${SPREADSHEETS_ENDPOINT}/${spreadsheetId}/values/Settings!A1?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ values }),
    }
  );
  if (!updateRes.ok) throw new Error(`Settings 값 입력 실패: ${updateRes.status}`);
}

export function monthTabFor(date) {
  return MONTH_TABS[date.getMonth()];
}

// Date | Category | Pay. Method | Amount | Memo | Currency 순서로 한 행을
// 해당 월 탭의 다음 빈 행에 추가한다. INSERT_ROWS를 쓰지 않고 OVERWRITE로
// 채워야 같은 행의 Overview/예산 박스가 밀리지 않는다.
export async function appendTransaction(accessToken, spreadsheetId, { date, category, payMethod, amount, memo, currency }) {
  const tab = monthTabFor(date);
  const dateStr = date.toISOString().slice(0, 10);
  const range = encodeURIComponent(`'${tab}'!A5:F`);
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
