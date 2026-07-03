import { LINKED_SHEET_STORAGE_KEY } from '../config.js';

// 앱이 직접 만들지 않은(지인이 이미 쓰던) 시트를 연결한 경우, Drive
// appProperties를 달 수 없어 이 브라우저에만 스프레드시트 ID를 기억한다.
// 다른 기기/브라우저에서 로그인하면 한 번 더 연결해야 한다 — 문서화된 V1 제약.
export function getLinkedSheetId() {
  return localStorage.getItem(LINKED_SHEET_STORAGE_KEY);
}

export function setLinkedSheetId(id) {
  localStorage.setItem(LINKED_SHEET_STORAGE_KEY, id);
}

export function clearLinkedSheetId() {
  localStorage.removeItem(LINKED_SHEET_STORAGE_KEY);
}
