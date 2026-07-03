import { DEFAULT_CURRENCIES, CURRENCY_SYMBOLS, CURRENCY_LABELS } from '../config.js';
import { readSettings, writeSettings } from './sheets-api.js';
import { spreadsheetEditUrl } from './drive-api.js';

let state = null;

const GROUP_LABELS = {
  incomeCategories: '수입 카테고리',
  fixedExpenseCategories: '고정 지출 카테고리',
  variableExpenseCategories: '변동 지출 카테고리',
  paymentMethods: '결제 수단',
};

function showStStatus(message, isError) {
  const el = document.getElementById('st-status');
  el.textContent = message;
  el.classList.toggle('is-error', Boolean(isError));
  el.hidden = false;
  clearTimeout(showStStatus._timer);
  showStStatus._timer = setTimeout(() => {
    el.hidden = true;
  }, 2500);
}

function renderCurrencyChips() {
  const el = document.getElementById('st-currency-chips');
  el.innerHTML = '';
  for (const cur of DEFAULT_CURRENCIES) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (cur === state.settings.defaultCurrency ? ' is-active' : '');
    chip.textContent = `${CURRENCY_SYMBOLS[cur]} ${CURRENCY_LABELS[cur]}`;
    chip.addEventListener('click', async () => {
      state.settings.defaultCurrency = cur;
      renderCurrencyChips();
      await persist();
    });
    el.appendChild(chip);
  }
}

function renderItemList() {
  document.getElementById('st-group-label').textContent = GROUP_LABELS[state.activeGroup];
  const list = document.getElementById('st-item-list');
  list.innerHTML = '';
  const items = state.settings[state.activeGroup];
  items.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'st-item';
    const name = document.createElement('span');
    name.textContent = item;
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'st-item-remove';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', async () => {
      items.splice(index, 1);
      renderItemList();
      await persist();
    });
    row.appendChild(name);
    row.appendChild(removeBtn);
    list.appendChild(row);
  });
}

async function persist() {
  try {
    await writeSettings(state.accessToken, state.spreadsheetId, state.settings);
  } catch (err) {
    showStStatus('저장하지 못했어요. 다시 시도해주세요.', true);
  }
}

async function handleAdd() {
  const input = document.getElementById('st-add-input');
  const value = input.value.trim();
  if (!value) return;
  state.settings[state.activeGroup].push(value);
  input.value = '';
  renderItemList();
  await persist();
}

// onBack(settings)는 사용자가 뒤로 가기를 눌렀을 때 최신 settings를 들고
// 호출된다 — 빠른 등록 화면이 카테고리/결제수단/기본통화를 즉시 반영할 수 있게.
export async function initSettings(accessToken, spreadsheetId, email, onBack) {
  state = {
    accessToken,
    spreadsheetId,
    activeGroup: 'incomeCategories',
    settings: await readSettings(accessToken, spreadsheetId),
  };

  document.getElementById('st-email').textContent = email;
  document.getElementById('st-avatar').textContent = (email.slice(0, 2) || '?').toUpperCase();
  document.getElementById('st-sheet-link').href = spreadsheetEditUrl(spreadsheetId);

  renderCurrencyChips();
  renderItemList();

  document.getElementById('st-group-tabs').onclick = (event) => {
    const btn = event.target.closest('button[data-group]');
    if (!btn) return;
    state.activeGroup = btn.dataset.group;
    document
      .querySelectorAll('#st-group-tabs button')
      .forEach((b) => b.classList.toggle('active', b === btn));
    renderItemList();
  };

  document.getElementById('st-add-btn').onclick = handleAdd;
  document.getElementById('st-back-btn').onclick = () => onBack(state.settings);
}
