// GCP 콘솔 > API 및 서비스 > 사용자 인증 정보에서 발급받은 OAuth 클라이언트 ID로 교체하세요.
// 공개 저장소에 노출돼도 무방한 값입니다 (client_secret이 아님).
export const CLIENT_ID = '477548989057-noq5kvg2vrt6skv7lurdhjn8puipblpo.apps.googleusercontent.com';

// 원본 가계부 템플릿 스프레드시트 ID (수정하지 마세요).
export const TEMPLATE_FILE_ID = '1l0d9NVkUR25zUaHjesSxESCTbAQVxYQ8cy822hVEt8w';

export const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

// 이 앱이 만든 사본 스프레드시트를 식별하기 위한 Drive appProperties 값.
export const APP_PROPERTY_KEY = 'householdBudgetApp';
export const APP_PROPERTY_VALUE = 'v1';
// 어느 연도용 사본인지 구분하는 두 번째 appProperties 키.
export const APP_PROPERTY_YEAR_KEY = 'householdBudgetYear';

// 앱이 직접 만들지 않은(지인이 이미 쓰던) 시트를 연결한 경우, appProperties를
// 달 수 없어 이 브라우저의 localStorage에만 기록해 기억한다.
export const LINKED_SHEET_STORAGE_KEY = 'hb_linked_sheet_id';

export const DEFAULT_CURRENCIES = ['KRW', 'JPY', 'USD'];
export const CURRENCY_SYMBOLS = { KRW: '₩', JPY: '¥', USD: '$' };
export const CURRENCY_LABELS = { KRW: '원', JPY: '엔', USD: '달러' };
export const DEFAULT_CURRENCY = 'KRW';

// 5단계(설정 화면)에서 Settings 탭을 읽어오기 전까지 쓰는 하드코딩된 기본값.
export const EXPENSE_CATEGORIES = ['식비', '카페·간식', '교통', '쇼핑', '의료'];
export const INCOME_CATEGORIES = ['급여', '용돈', '부수입'];
// "카드"처럼 뭉뚱그리지 않고 "신한카드"처럼 구체적인 이름을 쓰는 걸 전제로
// 한 예시 기본값. 실제로는 Settings 탭(또는 5단계 설정 화면)에서 각자
// 원하는 이름으로 자유롭게 추가/변경한다.
export const PAYMENT_METHODS = ['신한카드', '현금', '국민은행 계좌이체'];

// 월별 탭 이름 (템플릿 원본과 동일한 영문 약어). 9월만 다른 달과 달리
// 4글자 "Sept"라 실제 시트를 확인해서 얻은 값이다 — 절대 "Sep"으로 고치지 말 것.
export const MONTH_TABS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
