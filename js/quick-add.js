import {
  DEFAULT_CURRENCY,
  DEFAULT_CURRENCIES,
  CURRENCY_SYMBOLS,
  CURRENCY_LABELS,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  PAYMENT_METHODS,
} from '../config.js';
import { appendTransaction } from './sheets-api.js';

let state = null;

function categoriesForType() {
  return state.type === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
}

function renderCurrencyChips() {
  const el = document.getElementById('qa-currency-select');
  el.innerHTML = '';
  for (const cur of DEFAULT_CURRENCIES) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (cur === state.currency ? ' is-active' : '');
    chip.textContent = `${CURRENCY_SYMBOLS[cur]} ${CURRENCY_LABELS[cur]}`;
    chip.addEventListener('click', () => {
      state.currency = cur;
      document.getElementById('qa-currency-symbol').textContent = CURRENCY_SYMBOLS[cur];
      renderCurrencyChips();
    });
    el.appendChild(chip);
  }
}

function renderCategoryChips() {
  const el = document.getElementById('qa-category-chips');
  el.innerHTML = '';
  const cats = categoriesForType();
  if (!cats.includes(state.category)) state.category = cats[0];
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
  const el = document.getElementById('qa-payment-chips');
  el.innerHTML = '';
  for (const pm of PAYMENT_METHODS) {
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

function renderAmount() {
  const display = state.amountDigits === '' ? '0' : Number(state.amountDigits).toLocaleString('en-US');
  document.getElementById('qa-amount-display').textContent = display;
}

function appendDigits(digits) {
  const next = (state.amountDigits + digits).replace(/^0+(?=\d)/, '');
  if (next.length <= 12) state.amountDigits = next;
}

function handleKey(key) {
  if (key === 'back') {
    state.amountDigits = state.amountDigits.slice(0, -1);
  } else if (key === '000') {
    if (state.amountDigits !== '') appendDigits('000');
  } else {
    appendDigits(key);
  }
  renderAmount();
}

function showQaMessage(message, isError) {
  const el = document.getElementById('qa-status');
  el.textContent = message;
  el.classList.toggle('is-error', Boolean(isError));
  el.hidden = false;
  clearTimeout(showQaMessage._timer);
  showQaMessage._timer = setTimeout(() => {
    el.hidden = true;
  }, 3000);
}

function resetForm() {
  state.amountDigits = '';
  document.getElementById('qa-memo').value = '';
  renderAmount();
}

async function handleSubmit() {
  const amount = Number(state.amountDigits || '0');
  if (!amount) {
    showQaMessage('금액을 입력해주세요.', true);
    return;
  }

  const submitBtn = document.getElementById('qa-submit');
  submitBtn.disabled = true;
  try {
    await appendTransaction(state.accessToken, state.spreadsheetId, {
      date: new Date(),
      category: state.category,
      payMethod: state.payMethod,
      amount,
      memo: document.getElementById('qa-memo').value.trim(),
      currency: state.currency,
    });
    showQaMessage('등록했어요!', false);
    resetForm();
  } catch (err) {
    showQaMessage('등록에 실패했어요. 다시 시도해주세요.', true);
  } finally {
    submitBtn.disabled = false;
  }
}

export function initQuickAdd(accessToken, spreadsheetId, email) {
  state = {
    accessToken,
    spreadsheetId,
    type: 'expense',
    currency: DEFAULT_CURRENCY,
    amountDigits: '',
    category: EXPENSE_CATEGORIES[0],
    payMethod: PAYMENT_METHODS[0],
  };

  document.getElementById('qa-email').textContent = email;
  document.getElementById('qa-currency-symbol').textContent = CURRENCY_SYMBOLS[state.currency];

  renderCurrencyChips();
  renderCategoryChips();
  renderPaymentChips();
  renderAmount();

  document.getElementById('qa-keypad').addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-key]');
    if (btn) handleKey(btn.dataset.key);
  });

  document.getElementById('qa-segmented').addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-type]');
    if (!btn) return;
    state.type = btn.dataset.type;
    document
      .querySelectorAll('#qa-segmented button')
      .forEach((b) => b.classList.toggle('active', b === btn));
    renderCategoryChips();
  });

  document.getElementById('qa-submit').addEventListener('click', handleSubmit);
}

export function showOnboardingMessage(message) {
  showQaMessage(message, false);
}
