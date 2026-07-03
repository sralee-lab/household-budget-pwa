import { parseSpreadsheetId } from './drive-api.js';
import { getSheetTitles, createSettingsSheet } from './sheets-api.js';
import { setLinkedSheetId } from './local-store.js';

// 완전 신규 사용자에게 "새로 만들기" / "기존 시트 연결하기"를 고르게 한다.
// onCreateNew()는 호출되면 새 사본을 만드는 로직(연도 태그 포함)을 실행해야
// 하고, 성공 시 file 객체를, 실패 시 에러를 던져야 한다.
export function showOnboardingChoice({ accessToken, onCreateNew, onResolved }) {
  const screen = document.getElementById('screen-onboarding');
  const newBtn = document.getElementById('onboarding-new-btn');
  const linkBtn = document.getElementById('onboarding-link-btn');
  const linkPanel = document.getElementById('onboarding-link-panel');
  const linkInput = document.getElementById('onboarding-link-input');
  const linkConfirm = document.getElementById('onboarding-link-confirm');
  const linkError = document.getElementById('onboarding-link-error');

  function showLinkError(message) {
    linkError.textContent = message;
    linkError.hidden = !message;
  }

  async function handleNew() {
    const errorEl = document.getElementById('onboarding-error');
    errorEl.hidden = true;
    newBtn.disabled = true;
    try {
      const file = await onCreateNew();
      screen.hidden = true;
      onResolved(file);
    } catch (err) {
      newBtn.disabled = false;
      errorEl.textContent = '가계부를 만들지 못했어요. 다시 시도해주세요.';
      errorEl.hidden = false;
    }
  }

  function handleShowLinkPanel() {
    linkPanel.hidden = false;
    linkBtn.hidden = true;
    newBtn.hidden = true;
  }

  async function handleLinkConfirm() {
    const raw = linkInput.value.trim();
    if (!raw) {
      showLinkError('시트 URL이나 ID를 입력해주세요.');
      return;
    }
    const id = parseSpreadsheetId(raw);
    linkConfirm.disabled = true;
    showLinkError('');
    try {
      const titles = await getSheetTitles(accessToken, id);
      if (!titles.includes('Settings')) {
        await createSettingsSheet(accessToken, id);
      }
      setLinkedSheetId(id);
      screen.hidden = true;
      onResolved({ id });
    } catch (err) {
      showLinkError('이 시트를 열 수 없어요. 링크가 정확한지, 내 계정으로 접근 가능한 시트인지 확인해주세요.');
    } finally {
      linkConfirm.disabled = false;
    }
  }

  newBtn.hidden = false;
  linkBtn.hidden = false;
  linkPanel.hidden = true;
  linkInput.value = '';
  showLinkError('');
  newBtn.disabled = false;
  document.getElementById('onboarding-error').hidden = true;

  newBtn.onclick = handleNew;
  linkBtn.onclick = handleShowLinkPanel;
  linkConfirm.onclick = handleLinkConfirm;

  screen.hidden = false;
}
