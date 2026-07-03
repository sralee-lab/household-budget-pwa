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

export const DEFAULT_CURRENCIES = ['KRW', 'JPY', 'USD'];
export const CURRENCY_SYMBOLS = { KRW: '₩', JPY: '¥', USD: '$' };
export const CURRENCY_LABELS = { KRW: '원', JPY: '엔', USD: '달러' };
