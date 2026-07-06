import { DEFAULT_CURRENCIES, CURRENCY_SYMBOLS, CURRENCY_LABELS, EXPENSE_CATEGORIES, INCOME_CATEGORIES, PAYMENT_METHODS } from '../config.js';
import { updateTransactionRow, deleteTransactionRow, appendTransaction, monthTabFor, adjustAccountBalance } from './sheets-api.js';
import { convertAmountWithRate } from './fx.js';

let state = null;

// paymentMethods는 {name, type, linkedAccount} 레코드 배열이라, 칩 렌더링용
// 이름 목록과 "결제수단 → 연결 계좌" 조회 맵을 함께 만들어둔다(quick-add.js와
// 동일한 이유).
function deriveCategoryLists(settings) {
  const expense = [
    ...(settings.fixedExpenseCategories || []),
    ...(settings.variableExpenseCategories || []),
  ];
  const income = settings.incomeCategories || [];
  const paymentMethodRecords = (settings.paymentMethods || []).length
    ? settings.paymentMethods
    : PAYMENT_METHODS.map((name) => ({ name, type: '', linkedAccount: '' }));
  return {
    expense: expense.length ? expense : EXPENSE_CATEGORIES,
    income: income.length ? income : INCOME_CATEGORIES,
    paymentMethods: paymentMethodRecords.map((pm) => pm.name),
    paymentMethodAccounts: new Map(paymentMethodRecords.map((pm) => [pm.name, pm.linkedAccount || ''])),
    incomeCategories: income,
  };
}

// 거래 하나가 계좌에 미치는 영향을 계산한다. direction=-1이면 "이 거래가
// 원래 반영했던 효과를 되돌리기"(수정 전 값용), direction=+1이면 "이
// 거래를 새로 반영하기"(수정 후 값 또는 삭제 시 되돌리기 반대 방향)로 쓴다.
// 거래 통화가 계좌 고유 통화와 다르면 fx.js로 계좌 통화 기준으로 환산한다.
async function accountEffect(settings, accountName, category, amount, currency, dateStr, direction) {
  if (!accountName) return null;
  const account = (settings.accounts || []).find((a) => a.name === accountName);
  if (!account) return null;
  let amt = amount;
  if (currency !== account.currency) {
    try {
      const { convertedAmount } = await convertAmountWithRate(amount, currency, account.currency, dateStr);
      amt = convertedAmount;
    } catch (err) {
      // 환율 조회 실패 시 대시보드와 같은 원칙으로 액면가 그대로 반영.
    }
  }
  const isIncome = (settings.incomeCategories || []).includes(category);
  const sign = isIncome ? 1 : -1;
  return { accountName, delta: sign * amt * direction };
}

function showEtStatus(message, isError) {
  const el = document.getElementById('et-status');
  el.textContent = message;
  el.classList.toggle('is-error', Boolean(isError));
  el.hidden = false;
  clearTimeout(showEtStatus._timer);
  showEtStatus._timer = setTimeout(() => {
    el.hidden = true;
  }, 2500);
}

function renderCurrencyChips() {
  const el = document.getElementById('et-currency-chips');
  el.innerHTML = '';
  for (const cur of DEFAULT_CURRENCIES) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (cur === state.currency ? ' is-active' : '');
    chip.textContent = `${CURRENCY_SYMBOLS[cur]} ${CURRENCY_LABELS[cur]}`;
    chip.addEventListener('click', () => {
      state.currency = cur;
      document.getElementById('et-currency-symbol').textContent = CURRENCY_SYMBOLS[cur];
      renderCurrencyChips();
    });
    el.appendChild(chip);
  }
}

function renderCategoryChips() {
  const el = document.getElementById('et-category-chips');
  el.innerHTML = '';
  const isIncome = state.categoryLists.incomeCategories.includes(state.category);
  const cats = isIncome ? state.categoryLists.income : state.categoryLists.expense;
  for (const cat of cats) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (cat === state.category ? ' is-active' : '');
    chip.textContent = cat;
    chip.addEventListener('click', () => {
      state.category = cat;
      renderCategoryChips();
    });
    el.appendChild(chip);
  }
}

function renderPaymentChips() {
  const el = document.getElementById('et-payment-chips');
  el.innerHTML = '';
  for (const pm of state.categoryLists.paymentMethods) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (pm === state.payMethod ? ' is-active' : '');
    chip.textContent = pm;
    chip.addEventListener('click', () => {
      state.payMethod = pm;
      renderPaymentChips();
    });
    el.appendChild(chip);
  }
}

function resetConfirm() {
  document.getElementById('et-delete-btn').hidden = false;
  document.getElementById('et-save-btn').hidden = false;
  document.getElementById('et-confirm-row').hidden = true;
}

async function handleSave() {
  const amount = Number(document.getElementById('et-amount').value.replace(/[^\d]/g, '') || '0');
  const dateStr = document.getElementById('et-date').value;
  if (!amount || !dateStr) {
    showEtStatus('금액과 날짜를 확인해주세요.', true);
    return;
  }
  const memo = document.getElementById('et-memo').value.trim();
  const saveBtn = document.getElementById('et-save-btn');
  saveBtn.disabled = true;
  try {
    const newTab = monthTabFor(dateStr);
    const account = state.categoryLists.paymentMethodAccounts.get(state.payMethod) || '';
    const payload = { dateStr, category: state.category, payMethod: state.payMethod, amount, memo, currency: state.currency, account };

    if (newTab !== state.txn.monthTab) {
      // 다른 달로 옮겨졌으면: 새 달에 추가하고, 원래 있던 행은 지운다.
      await appendTransaction(state.accessToken, state.spreadsheetId, payload);
      await deleteTransactionRow(state.accessToken, state.spreadsheetId, state.txn.monthTab, state.txn.rowNumber);
    } else {
      await updateTransactionRow(state.accessToken, state.spreadsheetId, state.txn.monthTab, state.txn.rowNumber, payload);
    }

    // 계좌 잔액 반영: 수정 전 값이 남긴 효과를 되돌리고, 수정 후 값을 새로
    // 반영한다(같은 계좌면 두 호출이 합쳐져 차액만 반영되는 셈).
    const oldEffect = await accountEffect(
      state.settings, state.txn.account, state.txn.category, state.txn.amount, state.txn.currency, state.txn.dateStr, -1
    );
    const newEffect = await accountEffect(state.settings, account, payload.category, payload.amount, payload.currency, payload.dateStr, 1);
    if (oldEffect) await adjustAccountBalance(state.accessToken, state.spreadsheetId, state.settings, oldEffect.accountName, oldEffect.delta);
    if (newEffect) await adjustAccountBalance(state.accessToken, state.spreadsheetId, state.settings, newEffect.accountName, newEffect.delta);

    state.onSaved();
  } catch (err) {
    saveBtn.disabled = false;
    showEtStatus('저장하지 못했어요. 다시 시도해주세요.', true);
  }
}

async function handleDeleteConfirm() {
  const confirmBtn = document.getElementById('et-delete-confirm');
  confirmBtn.disabled = true;
  try {
    await deleteTransactionRow(state.accessToken, state.spreadsheetId, state.txn.monthTab, state.txn.rowNumber);
    const effect = await accountEffect(
      state.settings, state.txn.account, state.txn.category, state.txn.amount, state.txn.currency, state.txn.dateStr, -1
    );
    if (effect) await adjustAccountBalance(state.accessToken, state.spreadsheetId, state.settings, effect.accountName, effect.delta);
    state.onSaved();
  } catch (err) {
    confirmBtn.disabled = false;
    showEtStatus('삭제하지 못했어요. 다시 시도해주세요.', true);
  }
}

// txn: { rowNumber, monthTab, dateStr, category, payMethod, amount, memo, currency }
export function initEditTransaction(accessToken, spreadsheetId, settings, txn, onSaved, onBack) {
  state = {
    accessToken,
    spreadsheetId,
    settings: settings || { accounts: [], incomeCategories: [] },
    txn,
    category: txn.category,
    payMethod: txn.payMethod,
    currency: txn.currency,
    categoryLists: deriveCategoryLists(settings || {}),
    onSaved,
  };

  document.getElementById('et-date').value = txn.dateStr;
  document.getElementById('et-amount').value = txn.amount;
  document.getElementById('et-memo').value = txn.memo || '';
  document.getElementById('et-currency-symbol').textContent = CURRENCY_SYMBOLS[txn.currency];
  resetConfirm();
  document.getElementById('et-save-btn').disabled = false;
  document.getElementById('et-delete-confirm').disabled = false;

  renderCurrencyChips();
  renderCategoryChips();
  renderPaymentChips();

  document.getElementById('et-amount').oninput = (event) => {
    event.target.value = event.target.value.replace(/[^\d]/g, '');
  };

  document.getElementById('et-save-btn').onclick = handleSave;
  document.getElementById('et-delete-btn').onclick = () => {
    document.getElementById('et-delete-btn').hidden = true;
    document.getElementById('et-save-btn').hidden = true;
    document.getElementById('et-confirm-row').hidden = false;
  };
  document.getElementById('et-delete-cancel').onclick = resetConfirm;
  document.getElementById('et-delete-confirm').onclick = handleDeleteConfirm;
  document.getElementById('et-back-btn').onclick = onBack;
}
