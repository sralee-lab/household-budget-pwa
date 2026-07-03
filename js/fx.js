const FX_CACHE_PREFIX = 'hb_fx_';

// 거래 발생일 기준 환율을 적용한다 — 오늘 환율로 과거 거래를 일괄 환산하면
// 조회할 때마다 과거 합계가 달라져 장부로서 신뢰하기 어렵기 때문이다.
// 같은 (날짜, 통화쌍)은 localStorage에 캐싱해 반복 호출을 피한다.
export async function getHistoricalRate(dateStr, from, to) {
  if (from === to) return 1;

  const cacheKey = `${FX_CACHE_PREFIX}${dateStr}_${from}_${to}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached !== null) return Number(cached);

  const res = await fetch(`https://api.frankfurter.app/${dateStr}?from=${from}&to=${to}`);
  if (!res.ok) throw new Error(`환율 조회 실패: ${res.status}`);
  const data = await res.json();
  const rate = data.rates[to];
  localStorage.setItem(cacheKey, String(rate));
  return rate;
}

export async function convertAmount(amount, fromCurrency, toCurrency, dateStr) {
  if (fromCurrency === toCurrency) return amount;
  const rate = await getHistoricalRate(dateStr, fromCurrency, toCurrency);
  return amount * rate;
}
