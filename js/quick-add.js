import {
  DEFAULT_CURRENCY,
  DEFAULT_CURRENCIES,
  CURRENCY_SYMBOLS,
  CURRENCY_LABELS,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  PAYMENT_METHODS,
} from '../config.js';
import { appendTransaction, appendTransactions, adjustAccountBalance } from './sheets-api.js';
import { convertAmountWithRate } from './fx.js';

let state = null;
let nextQueueId = 1;

// Settings 탭에서 읽어온 값을 우선 쓰고, 비어 있으면(설정을 전부 지웠거나
// 아직 못 읽어온 경우) config.js의 하드코딩된 기본값으로 대체한다.
// paymentMethods는 이제 {name, type, linkedAccount} 레코드 배열이라, 칩
// 렌더링용 이름 목록과 "이 결제수단이 어느 계좌에 연결됐는지" 조회용 맵을
// 함께 만들어둔다.
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
  };
}

function categoriesForType(type) {
  return type === 'expense' ? state.categoryLists.expense : state.categoryLists.income;
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
  const methods = state.categoryLists.paymentMethods;
  if (!methods.includes(state.payMethod)) state.payMethod = methods[0];
  for (const pm of methods) {
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

// 등록 버튼 자체에서 성공을 확인할 수 있게, 도장 애니메이션 동안 버튼
// 라벨을 잠깐 "완료"로 바꿨다가 되돌린다 — 성공 메시지가 화면 위쪽에만
// 떠서 등록 버튼(화면 아래)을 누른 시선과 멀어 놓치기 쉽다는 피드백 반영.
function playStampAnimation() {
  const btn = document.getElementById('qa-submit');
  if (!btn.dataset.originalLabel) btn.dataset.originalLabel = btn.textContent;
  btn.classList.remove('is-stamped');
  // 리플로우를 강제해 같은 클래스를 다시 붙여도 애니메이션이 재생되게 한다.
  void btn.offsetWidth;
  btn.classList.add('is-stamped');
  // 84px 원형 버튼 안에 들어가야 해서 기존 "등록"과 길이가 비슷한 두 글자로
  // 맞춘다(체크 기호까지 넣으면 원 밖으로 넘칠 수 있어 제외).
  btn.textContent = '완료';
  clearTimeout(playStampAnimation._timer);
  playStampAnimation._timer = setTimeout(() => {
    btn.classList.remove('is-stamped');
    btn.textContent = btn.dataset.originalLabel;
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
    account: state.categoryLists.paymentMethodAccounts.get(state.payMethod) || '',
  };
}

// 등록된 거래가 계좌에 연결돼 있으면 그 계좌의 현재 잔액을 반영한다(지출은
// 차감, 수입은 증가). 거래 통화가 계좌 고유 통화와 다르면 fx.js로 계좌
// 통화 기준으로 환산한다(대시보드가 기본 통화로 환산하는 것과 같은
// 원리이되, 기준 통화가 "계좌 자신의 통화"라는 점만 다르다).
async function applyAccountDelta(entry) {
  if (!entry.account) return;
  const account = (state.settings.accounts || []).find((a) => a.name === entry.account);
  if (!account) return;
  let amt = entry.amount;
  if (entry.currency !== account.currency) {
    try {
      const { convertedAmount } = await convertAmountWithRate(entry.amount, entry.currency, account.currency, entry.dateStr);
      amt = convertedAmount;
    } catch (err) {
      // 환율 조회 실패 시 대시보드와 같은 원칙으로 액면가 그대로 반영.
    }
  }
  const delta = entry.type === 'income' ? amt : -amt;
  await adjustAccountBalance(state.accessToken, state.spreadsheetId, state.settings, entry.account, delta);
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
    for (const entry of entries) {
      await applyAccountDelta(entry);
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

export function initQuickAdd(accessToken, spreadsheetId, email, settings) {
  const categoryLists = deriveCategoryLists(settings || {});
  state = {
    accessToken,
    spreadsheetId,
    settings: settings || { accounts: [] },
    type: 'expense',
    currency: (settings && settings.defaultCurrency) || DEFAULT_CURRENCY,
    amountDigits: '',
    categoryLists,
    category: categoryLists.expense[0],
    payMethod: categoryLists.paymentMethods[0],
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

// 설정 화면에서 돌아왔을 때 카테고리/결제수단/기본통화/계좌 목록을 즉시 반영한다.
export function updateQuickAddSettings(settings) {
  if (!state) return;
  state.settings = settings || { accounts: [] };
  state.categoryLists = deriveCategoryLists(settings || {});
  renderCategoryChips();
  renderPaymentChips();
}
