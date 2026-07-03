import { DEFAULT_CURRENCIES, CURRENCY_SYMBOLS, CURRENCY_LABELS, EXPENSE_CATEGORIES, INCOME_CATEGORIES, PAYMENT_METHODS } from '../config.js';
import { updateTransactionRow, deleteTransactionRow, appendTransaction, monthTabFor } from './sheets-api.js';

let state = null;

function deriveCategoryLists(settings) {
  const expense = [
    ...(settings.fixedExpenseCategories || []),
    ...(settings.variableExpenseCategories || []),
  ];
  const income = settings.incomeCategories || [];
  const paymentMethods = settings.paymentMethods || [];
  return {
    expense: expense.length ? expense : EXPENSE_CATEGORIES,
    income: income.length ? income : INCOME_CATEGORIES,
    paymentMethods: paymentMethods.length ? paymentMethods : PAYMENT_METHODS,
    incomeCategories: income,
  };
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
    const payload = { dateStr, category: state.category, payMethod: state.payMethod, amount, memo, currency: state.currency };

    if (newTab !== state.txn.monthTab) {
      // 다른 달로 옮겨졌으면: 새 달에 추가하고, 원래 있던 행은 지운다.
      await appendTransaction(state.accessToken, state.spreadsheetId, payload);
      await deleteTransactionRow(state.accessToken, state.spreadsheetId, state.txn.monthTab, state.txn.rowNumber);
    } else {
      await updateTransactionRow(state.accessToken, state.spreadsheetId, state.txn.monthTab, state.txn.rowNumber, payload);
    }
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
