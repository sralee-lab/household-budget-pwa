import {
  DEFAULT_CURRENCY,
  DEFAULT_CURRENCIES,
  CURRENCY_SYMBOLS,
  CURRENCY_LABELS,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  PAYMENT_METHODS,
} from '../config.js';
import { appendTransaction, appendTransactions } from './sheets-api.js';

let state = null;
let nextQueueId = 1;

function categoriesForType(type) {
  return type === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
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
  const cats = categoriesForType(state.type);
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

function todayLocalDateStr() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function renderAmount() {
  const input = document.getElementById('qa-amount-display');
  if (state.keyboardMode) {
    input.value = state.amountDigits;
  } else {
    input.value = state.amountDigits === '' ? '0' : Number(state.amountDigits).toLocaleString('en-US');
  }
  // 브라우저 기본 input 너비는 내용보다 훨씬 넓어서, 옆의 커서(캐럿) 장식이
  // 숫자와 멀리 떨어져 보이는 문제가 있었다. 글자 수에 맞춰 너비를 좁힌다.
  input.style.width = `${Math.max(input.value.length, 1)}ch`;
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

function setInputMode(keyboardMode) {
  state.keyboardMode = keyboardMode;
  const input = document.getElementById('qa-amount-display');
  const keypad = document.getElementById('qa-keypad');
  const toggleBtn = document.getElementById('qa-input-mode-toggle');
  const caret = document.querySelector('.qa-amount .caret');

  input.readOnly = !keyboardMode;
  keypad.hidden = keyboardMode;
  toggleBtn.textContent = keyboardMode ? '⌨ 키패드로 입력' : '⌨ 키보드로 입력';
  if (caret) caret.hidden = keyboardMode;

  renderAmount();
  if (keyboardMode) input.focus();
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

function playStampAnimation() {
  const btn = document.getElementById('qa-submit');
  btn.classList.remove('is-stamped');
  // 리플로우를 강제해 같은 클래스를 다시 붙여도 애니메이션이 재생되게 한다.
  void btn.offsetWidth;
  btn.classList.add('is-stamped');
  clearTimeout(playStampAnimation._timer);
  playStampAnimation._timer = setTimeout(() => {
    btn.classList.remove('is-stamped');
  }, 900);
}

function resetForm() {
  state.amountDigits = '';
  document.getElementById('qa-memo').value = '';
  renderAmount();
  // 날짜/카테고리/결제수단/통화/지출·수입 구분은 초기화하지 않는다 —
  // 같은 조건으로 여러 건 연달아 등록하는 경우가 흔함.
}

function currentEntryOrNull() {
  const amount = Number(state.amountDigits || '0');
  if (!amount) return null;
  const dateStr = document.getElementById('qa-date').value;
  if (!dateStr) return null;
  return {
    dateStr,
    type: state.type,
    category: state.category,
    payMethod: state.payMethod,
    amount,
    memo: document.getElementById('qa-memo').value.trim(),
    currency: state.currency,
  };
}

function describeEntry(entry) {
  const symbol = CURRENCY_SYMBOLS[entry.currency];
  const md = `${Number(entry.dateStr.slice(5, 7))}/${Number(entry.dateStr.slice(8, 10))}`;
  return `${md} · ${entry.category} · ${symbol}${entry.amount.toLocaleString('en-US')}`;
}

function renderQueue() {
  const section = document.getElementById('qa-queue-section');
  const list = document.getElementById('qa-queue-list');
  const label = document.getElementById('qa-queue-label');
  section.hidden = state.queue.length === 0;
  label.textContent = `담아둔 항목 (${state.queue.length})`;
  list.innerHTML = '';
  for (const item of state.queue) {
    const row = document.createElement('div');
    row.className = 'qa-queue-item';
    const desc = document.createElement('span');
    desc.className = 'qa-queue-item-desc';
    desc.textContent = describeEntry(item);
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'qa-queue-item-remove';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => {
      state.queue = state.queue.filter((q) => q.id !== item.id);
      renderQueue();
    });
    row.appendChild(desc);
    row.appendChild(removeBtn);
    list.appendChild(row);
  }
}

function handleQueueAdd() {
  const entry = currentEntryOrNull();
  if (!entry) {
    showQaMessage('담을 금액과 날짜를 먼저 입력해주세요.', true);
    return;
  }
  state.queue.push({ id: nextQueueId++, ...entry });
  renderQueue();
  resetForm();
  showQaMessage('목록에 담았어요. 계속 등록하거나 "등록"을 눌러 한번에 저장하세요.', false);
}

async function handleSubmit() {
  const current = currentEntryOrNull();
  const entries = [...state.queue, ...(current ? [current] : [])];

  if (entries.length === 0) {
    showQaMessage('금액과 날짜를 입력해주세요.', true);
    return;
  }

  const submitBtn = document.getElementById('qa-submit');
  submitBtn.disabled = true;
  try {
    if (entries.length === 1) {
      await appendTransaction(state.accessToken, state.spreadsheetId, entries[0]);
    } else {
      await appendTransactions(state.accessToken, state.spreadsheetId, entries);
    }
    playStampAnimation();
    showQaMessage(entries.length === 1 ? '등록했어요!' : `${entries.length}건 등록했어요!`, false);
    state.queue = [];
    renderQueue();
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
    keyboardMode: false,
    queue: [],
  };

  document.getElementById('qa-email').textContent = email;
  document.getElementById('qa-currency-symbol').textContent = CURRENCY_SYMBOLS[state.currency];
  document.getElementById('qa-date').value = todayLocalDateStr();

  renderCurrencyChips();
  renderCategoryChips();
  renderPaymentChips();
  renderAmount();
  renderQueue();
  setInputMode(false);

  document.getElementById('qa-keypad').addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-key]');
    if (btn) handleKey(btn.dataset.key);
  });

  document.getElementById('qa-amount-display').addEventListener('input', (event) => {
    if (!state.keyboardMode) return;
    const digits = event.target.value.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '').slice(0, 12);
    state.amountDigits = digits;
    renderAmount();
  });

  document.getElementById('qa-input-mode-toggle').addEventListener('click', () => {
    setInputMode(!state.keyboardMode);
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

  document.getElementById('qa-queue-add').addEventListener('click', handleQueueAdd);
  document.getElementById('qa-submit').addEventListener('click', handleSubmit);
}

export function showOnboardingMessage(message) {
  showQaMessage(message, false);
}
