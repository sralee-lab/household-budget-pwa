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
