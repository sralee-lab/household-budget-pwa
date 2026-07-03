import { MONTH_TABS, CURRENCY_SYMBOLS } from '../config.js';
import { readMonthLog } from './sheets-api.js';
import { convertAmount } from './fx.js';

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
  const sorted = [...state.transactions].sort((a, b) => b.dateStr.localeCompare(a.dateStr)).slice(0, 15);

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
    amountSpan.textContent = formatMoney(t.convertedAmount, currency);

    if (t.currency !== currency) {
      const orig = document.createElement('span');
      orig.className = 'fx-original';
      orig.textContent = `${formatMoney(t.amount, t.currency)} · ${md} 환율`;
      amountSpan.appendChild(orig);
    }

    row.appendChild(catSpan);
    row.appendChild(dots);
    row.appendChild(amountSpan);
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

  for (const row of rows) {
    let convertedAmount;
    try {
      convertedAmount = await convertAmount(row.amount, row.currency, target, row.dateStr);
    } catch (err) {
      convertedAmount = row.amount; // 환율 조회 실패 시 액면가로 대체(가장 안전한 폴백)
    }
    const isIncome = incomeCategories.includes(row.category);

    if (isIncome) {
      totalIncome += convertedAmount;
    } else {
      totalExpense += convertedAmount;
      categoryTotals.set(row.category, (categoryTotals.get(row.category) || 0) + convertedAmount);
      paymentTotals.set(row.payMethod, (paymentTotals.get(row.payMethod) || 0) + convertedAmount);
    }
    transactions.push({ ...row, convertedAmount, isIncome });
  }

  state.totalIncome = totalIncome;
  state.totalExpense = totalExpense;
  state.categoryTotals = categoryTotals;
  state.paymentTotals = paymentTotals;
  state.transactions = transactions;

  renderSummary();
  renderActiveBreakdown();
  renderRecentList();
}

export async function initDashboard(accessToken, spreadsheetId, settings) {
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
