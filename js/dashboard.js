import { MONTH_TABS, CURRENCY_SYMBOLS } from '../config.js';
import { readMonthLog } from './sheets-api.js';
import { convertAmountWithRate } from './fx.js';

let state = null;

function formatMoney(amount, currency) {
  const symbol = CURRENCY_SYMBOLS[currency] || '';
  const sign = amount < 0 ? '-' : '';
  return `${sign}${symbol}${Math.round(Math.abs(amount)).toLocaleString('en-US')}`;
}

function showDbStatus(message, isError) {
  const el = document.getElementById('db-status');
  el.textContent = message;
  el.classList.toggle('is-error', Boolean(isError));
  el.hidden = false;
}

function hideDbStatus() {
  document.getElementById('db-status').hidden = true;
}

function renderMonthChips() {
  const el = document.getElementById('db-month-chips');
  el.innerHTML = '';
  MONTH_TABS.forEach((_, index) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (index === state.monthIndex ? ' is-active' : '');
    chip.textContent = `${index + 1}월`;
    chip.addEventListener('click', () => {
      if (state.monthIndex === index) return;
      state.monthIndex = index;
      loadAndRender();
    });
    el.appendChild(chip);
  });
}

function renderSummary() {
  const currency = state.settings.defaultCurrency;
  document.getElementById('db-income').textContent = formatMoney(state.totalIncome, currency);
  document.getElementById('db-expense').textContent = formatMoney(state.totalExpense, currency);

  const balance = state.totalIncome - state.totalExpense;
  const balanceEl = document.getElementById('db-balance');
  balanceEl.textContent = (balance >= 0 ? '+' : '-') + formatMoney(balance, currency);
  balanceEl.classList.toggle('income', balance >= 0);
  balanceEl.classList.toggle('expense', balance < 0);
}

// 계좌는 선택한 달과 무관하게 항상 "현재" 잔액을 보여준다(각 계좌 고유
// 통화 그대로 — 기본 통화로 억지 환산하지 않음, 실제 그 계좌에 들어있는
// 금액을 그대로 보여주는 게 더 정확하다).
function renderAccountCards() {
  const section = document.getElementById('db-accounts');
  const accounts = state.settings.accounts || [];
  if (accounts.length === 0) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  section.innerHTML = '';

  const label = document.createElement('div');
  label.className = 'db-summary-label';
  label.textContent = '계좌 잔액';
  section.appendChild(label);

  for (const acc of accounts) {
    const row = document.createElement('div');
    row.className = 'ledger-row';
    const name = document.createElement('span');
    name.className = 'ledger-cat';
    name.textContent = acc.name;
    const dots = document.createElement('span');
    dots.className = 'ledger-dots';
    const amount = document.createElement('span');
    amount.className = 'ledger-amount figure';
    amount.textContent = formatMoney(acc.currentBalance, acc.currency);
    row.appendChild(name);
    row.appendChild(dots);
    row.appendChild(amount);
    section.appendChild(row);
  }
}

function renderEmptyRow(list, message) {
  const empty = document.createElement('div');
  empty.className = 'ledger-empty';
  empty.textContent = message;
  list.appendChild(empty);
}

function renderActiveBreakdown() {
  const list = document.getElementById('db-breakdown-list');
  list.innerHTML = '';
  const currency = state.settings.defaultCurrency;
  const totals = state.activeTab === 'category' ? state.categoryTotals : state.paymentTotals;

  if (totals.size === 0) {
    renderEmptyRow(list, '이 달엔 등록된 지출이 없어요.');
    return;
  }

  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  for (const [label, amount] of sorted) {
    const row = document.createElement('div');
    row.className = 'ledger-row';

    const catSpan = document.createElement('span');
    catSpan.className = 'ledger-cat';
    catSpan.textContent = label;

    const dots = document.createElement('span');
    dots.className = 'ledger-dots';

    const amountSpan = document.createElement('span');
    amountSpan.className = 'ledger-amount figure expense';
    amountSpan.textContent = formatMoney(amount, currency);

    row.appendChild(catSpan);
    row.appendChild(dots);
    row.appendChild(amountSpan);
    list.appendChild(row);
  }
}

function renderRecentList() {
  const el = document.getElementById('db-recent-list');
  el.innerHTML = '';
  const currency = state.settings.defaultCurrency;
  // 예전엔 15건까지만 보여줬는데, 카드 한 장만 써도 한 달에 60건이 훌쩍
  // 넘어가는 경우가 흔해 그 뒤 거래는 아예 수정/삭제할 방법이 없었다.
  // 이제 이번 달 전체 거래를 다 보여준다.
  const sorted = [...state.transactions].sort((a, b) => b.dateStr.localeCompare(a.dateStr));

  if (sorted.length === 0) {
    renderEmptyRow(el, '이 달엔 등록된 거래가 없어요.');
    return;
  }

  for (const t of sorted) {
    const row = document.createElement('div');
    row.className = 'ledger-row';

    const md = `${Number(t.dateStr.slice(5, 7))}/${Number(t.dateStr.slice(8, 10))}`;
    const catSpan = document.createElement('span');
    catSpan.className = 'ledger-cat';
    catSpan.textContent = `${md} · ${t.category}`;

    const dots = document.createElement('span');
    dots.className = 'ledger-dots';

    const amountSpan = document.createElement('span');
    amountSpan.className = 'ledger-amount figure ' + (t.isIncome ? 'income' : 'expense');

    if (t.fxFailed) {
      // 환율 조회 실패 - 환산된 척 보여주면 안 되니 원래 통화 그대로 표시.
      amountSpan.textContent = formatMoney(t.amount, t.currency);
      const warn = document.createElement('span');
      warn.className = 'fx-original fx-warning';
      warn.textContent = '환율 조회 실패 - 합계 미반영';
      amountSpan.appendChild(warn);
    } else {
      amountSpan.textContent = formatMoney(t.convertedAmount, currency);
      if (t.currency !== currency) {
        const fromSymbol = CURRENCY_SYMBOLS[t.currency] || '';
        const toSymbol = CURRENCY_SYMBOLS[currency] || '';
        const rateText = t.rate ? `${fromSymbol}1 = ${toSymbol}${t.rate.toFixed(2)}` : '';
        const orig = document.createElement('span');
        orig.className = 'fx-original';
        orig.textContent = `${formatMoney(t.amount, t.currency)} · ${rateText} (${md})`;
        amountSpan.appendChild(orig);
      }
    }

    row.appendChild(catSpan);
    row.appendChild(dots);
    row.appendChild(amountSpan);

    if (state.onEditTransaction) {
      row.classList.add('is-clickable');
      row.addEventListener('click', () => state.onEditTransaction(t));
    }

    el.appendChild(row);
  }
}

async function loadAndRender() {
  renderMonthChips();
  document.getElementById('db-title').textContent = `${state.monthIndex + 1}월 요약`;
  document.getElementById('db-yearline').textContent =
    `${new Date().getFullYear()} · ${CURRENCY_SYMBOLS[state.settings.defaultCurrency]} 기준`;

  hideDbStatus();
  const breakdownList = document.getElementById('db-breakdown-list');
  breakdownList.innerHTML = '';
  renderEmptyRow(breakdownList, '불러오는 중...');
  document.getElementById('db-recent-list').innerHTML = '';

  const tab = MONTH_TABS[state.monthIndex];
  let rows;
  try {
    rows = await readMonthLog(state.accessToken, state.spreadsheetId, tab);
  } catch (err) {
    showDbStatus('데이터를 불러오지 못했어요. 다시 시도해주세요.', true);
    breakdownList.innerHTML = '';
    return;
  }

  const target = state.settings.defaultCurrency;
  const incomeCategories = state.settings.incomeCategories || [];
  let totalIncome = 0;
  let totalExpense = 0;
  const categoryTotals = new Map();
  const paymentTotals = new Map();
  const transactions = [];
  let fxErrorCount = 0;

  for (const row of rows) {
    let convertedAmount;
    let rate = 1;
    let fxFailed = false;
    try {
      ({ convertedAmount, rate } = await convertAmountWithRate(row.amount, row.currency, target, row.dateStr));
    } catch (err) {
      // 환율 조회 실패 시 액면가로 대체하되, 조용히 넘어가지 않고 아래에서
      // 사용자에게 알린다 — 다른 통화 거래가 환산 없이 섞여 합계가 틀려
      // 보일 수 있기 때문(frankfurter.app -> .dev 도메인 이전 때 실제로 겪은 문제).
      convertedAmount = row.amount;
      fxFailed = row.currency !== target;
      if (fxFailed) fxErrorCount++;
    }
    const isIncome = incomeCategories.includes(row.category);

    if (isIncome) {
      totalIncome += convertedAmount;
    } else {
      totalExpense += convertedAmount;
      categoryTotals.set(row.category, (categoryTotals.get(row.category) || 0) + convertedAmount);
      paymentTotals.set(row.payMethod, (paymentTotals.get(row.payMethod) || 0) + convertedAmount);
    }
    transactions.push({ ...row, convertedAmount, isIncome, fxFailed, rate });
  }

  state.totalIncome = totalIncome;
  state.totalExpense = totalExpense;
  state.categoryTotals = categoryTotals;
  state.paymentTotals = paymentTotals;
  state.transactions = transactions;

  if (fxErrorCount > 0) {
    showDbStatus(
      `환율 조회에 실패해 ${fxErrorCount}건은 환산 없이 원래 금액으로 합산했어요. 합계가 부정확할 수 있어요.`,
      true
    );
  }

  renderSummary();
  renderAccountCards();
  renderActiveBreakdown();
  renderRecentList();
}

export async function initDashboard(accessToken, spreadsheetId, settings, onEditTransaction) {
  state = {
    accessToken,
    spreadsheetId,
    settings,
    monthIndex: new Date().getMonth(),
    activeTab: 'category',
    totalIncome: 0,
    totalExpense: 0,
    categoryTotals: new Map(),
    paymentTotals: new Map(),
    transactions: [],
    onEditTransaction,
  };

  document.getElementById('db-tabs').onclick = (event) => {
    const btn = event.target.closest('.db-tab');
    if (!btn) return;
    state.activeTab = btn.dataset.tab;
    document.querySelectorAll('.db-tab').forEach((b) => b.classList.toggle('active', b === btn));
    renderActiveBreakdown();
  };

  await loadAndRender();
}

// 거래 수정/삭제 후 같은 달을 다시 불러온다(선택된 달을 초기화하지 않기 위해
// initDashboard를 다시 부르지 않고 이 함수를 쓴다).
export async function reloadCurrentMonth() {
  if (!state) return;
  await loadAndRender();
}
