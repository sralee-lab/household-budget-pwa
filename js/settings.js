import { DEFAULT_CURRENCIES, CURRENCY_SYMBOLS, CURRENCY_LABELS } from '../config.js';
import { readSettings, writeSettings, recalculateAccountBalance } from './sheets-api.js';
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

// incomeCategories/fixedExpenseCategories/variableExpenseCategories는 단순
// 문자열 목록이지만, paymentMethods는 {name, type, linkedAccount} 레코드라
// 이름을 꺼내는 방법이 다르다.
function itemName(item) {
  return typeof item === 'string' ? item : item.name;
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
    name.textContent = itemName(item);
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

    if (state.activeGroup === 'paymentMethods') {
      list.appendChild(renderPaymentAccountLinkRow(item));
    }
  });
}

// 결제수단 항목 아래에 "연결 계좌" 선택 서브 로우를 붙인다. 체크카드/현금처럼
// 즉시 차감되는 결제수단만 연결하면 되고(신용카드는 3단계 카드 모델 전까진
// 그냥 비워두면 됨), 연결해두면 빠른 등록에서 그 결제수단으로 거래를
// 등록할 때마다 연결 계좌 잔액이 자동으로 반영된다.
function renderPaymentAccountLinkRow(pm) {
  const row = document.createElement('div');
  row.className = 'st-account-link-row';

  const label = document.createElement('span');
  label.className = 'st-account-link-label';
  label.textContent = '↳ 연결 계좌';

  const select = document.createElement('select');
  select.className = 'st-account-link-select';
  const noneOption = document.createElement('option');
  noneOption.value = '';
  noneOption.textContent = '연결 안 함';
  select.appendChild(noneOption);
  for (const acc of state.settings.accounts) {
    const option = document.createElement('option');
    option.value = acc.name;
    option.textContent = acc.name;
    select.appendChild(option);
  }
  select.value = pm.linkedAccount || '';

  select.addEventListener('change', async () => {
    pm.linkedAccount = select.value;
    await persist();
  });

  row.appendChild(label);
  row.appendChild(select);
  return row;
}

function renderAccountList() {
  const list = document.getElementById('st-accounts-list');
  list.innerHTML = '';
  for (const acc of state.settings.accounts) {
    const row = document.createElement('div');
    row.className = 'st-item st-account-item';

    const info = document.createElement('div');
    info.className = 'st-account-item-info';
    const name = document.createElement('span');
    name.className = 'st-account-item-name';
    name.textContent = acc.name;
    const balance = document.createElement('span');
    balance.className = 'st-account-item-balance';
    const symbol = CURRENCY_SYMBOLS[acc.currency] || '';
    balance.textContent = `${symbol}${Math.round(acc.currentBalance).toLocaleString('en-US')}`;
    info.appendChild(name);
    info.appendChild(balance);

    const actions = document.createElement('div');
    actions.className = 'st-account-item-actions';
    const recalcBtn = document.createElement('button');
    recalcBtn.type = 'button';
    recalcBtn.className = 'st-link';
    recalcBtn.textContent = '다시 계산';
    recalcBtn.addEventListener('click', async () => {
      recalcBtn.disabled = true;
      try {
        await recalculateAccountBalance(state.accessToken, state.spreadsheetId, state.settings, acc.name);
        renderAccountList();
        showStStatus(`${acc.name} 잔액을 다시 계산했어요.`, false);
      } catch (err) {
        showStStatus('다시 계산하지 못했어요. 다시 시도해주세요.', true);
      } finally {
        recalcBtn.disabled = false;
      }
    });
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'st-item-remove';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', async () => {
      state.settings.accounts = state.settings.accounts.filter((a) => a.name !== acc.name);
      renderAccountList();
      renderItemList(); // 결제수단 서브로우의 연결 계좌 옵션 목록도 갱신
      await persist();
    });

    actions.appendChild(recalcBtn);
    actions.appendChild(removeBtn);
    row.appendChild(info);
    row.appendChild(actions);
    list.appendChild(row);
  }
}

function renderAccountCurrencyChips() {
  const el = document.getElementById('st-account-currency-select');
  el.innerHTML = '';
  for (const cur of DEFAULT_CURRENCIES) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (cur === state.newAccountCurrency ? ' is-active' : '');
    chip.textContent = `${CURRENCY_SYMBOLS[cur]} ${CURRENCY_LABELS[cur]}`;
    chip.addEventListener('click', () => {
      state.newAccountCurrency = cur;
      renderAccountCurrencyChips();
    });
    el.appendChild(chip);
  }
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
  if (state.activeGroup === 'paymentMethods') {
    state.settings.paymentMethods.push({ name: value, type: '', linkedAccount: '' });
  } else {
    state.settings[state.activeGroup].push(value);
  }
  input.value = '';
  renderItemList();
  await persist();
}

async function handleAddAccount() {
  const nameInput = document.getElementById('st-account-name-input');
  const balanceInput = document.getElementById('st-account-balance-input');
  const name = nameInput.value.trim();
  if (!name) return;
  const startingBalance = Number(balanceInput.value || '0');
  state.settings.accounts.push({
    name,
    currency: state.newAccountCurrency,
    startingBalance,
    currentBalance: startingBalance,
  });
  nameInput.value = '';
  balanceInput.value = '';
  renderAccountList();
  renderItemList(); // 새 계좌가 결제수단 연결 옵션에 바로 나타나도록
  await persist();
}

// onBack(settings)는 사용자가 뒤로 가기를 눌렀을 때 최신 settings를 들고
// 호출된다 — 빠른 등록 화면이 카테고리/결제수단/기본통화/계좌를 즉시
// 반영할 수 있게.
export async function initSettings(accessToken, spreadsheetId, email, onBack) {
  state = {
    accessToken,
    spreadsheetId,
    activeGroup: 'incomeCategories',
    settings: await readSettings(accessToken, spreadsheetId),
    newAccountCurrency: DEFAULT_CURRENCIES[0],
  };

  document.getElementById('st-email').textContent = email;
  document.getElementById('st-avatar').textContent = (email.slice(0, 2) || '?').toUpperCase();
  document.getElementById('st-sheet-link').href = spreadsheetEditUrl(spreadsheetId);

  renderCurrencyChips();
  renderItemList();
  renderAccountList();
  renderAccountCurrencyChips();

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
  document.getElementById('st-account-add-btn').onclick = handleAddAccount;
  document.getElementById('st-back-btn').onclick = () => onBack(state.settings);
}
