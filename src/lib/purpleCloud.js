// ─── Rolling window sum ───────────────────────────────────────────────────────
function rsum(arr, end, len) {
  let s = 0;
  const start = Math.max(0, end - len + 1);
  for (let i = start; i <= end; i++) s += arr[i];
  return s;
}

// ─── Wilder's ATR ─────────────────────────────────────────────────────────────
function calcATR(candles, period) {
  const n = candles.length;
  const tr = new Array(n);
  tr[0] = candles[0].h - candles[0].l;
  for (let i = 1; i < n; i++) {
    tr[i] = Math.max(
      candles[i].h - candles[i].l,
      Math.abs(candles[i].h - candles[i - 1].c),
      Math.abs(candles[i].l - candles[i - 1].c)
    );
  }
  const atr = new Array(n).fill(0);
  let init = 0;
  for (let i = 0; i < Math.min(period, n); i++) init += tr[i];
  atr[Math.min(period - 1, n - 1)] = init / Math.min(period, n);
  for (let i = period; i < n; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  }
  return atr;
}

// ─── Supertrend ───────────────────────────────────────────────────────────────
// Returns dir[]: -1 = bullish (price above ST), 1 = bearish (price below ST)
function calcSupertrend(candles, period = 10, factor = 3.0) {
  const n = candles.length;
  const atr = calcATR(candles, period);
  const upper = new Array(n).fill(0);
  const lower = new Array(n).fill(0);
  const st    = new Array(n).fill(0);
  const dir   = new Array(n).fill(1);

  for (let i = 0; i < n; i++) {
    const mid  = (candles[i].h + candles[i].l) / 2;
    const rawU = mid + factor * atr[i];
    const rawL = mid - factor * atr[i];

    if (i === 0) {
      upper[i] = rawU; lower[i] = rawL; st[i] = rawU; dir[i] = 1;
      continue;
    }

    upper[i] = (rawU < upper[i-1] || candles[i-1].c > upper[i-1]) ? rawU : upper[i-1];
    lower[i] = (rawL > lower[i-1] || candles[i-1].c < lower[i-1]) ? rawL : lower[i-1];

    if (st[i-1] === upper[i-1]) {
      st[i]  = candles[i].c <= upper[i] ? upper[i] : lower[i];
      dir[i] = candles[i].c <= upper[i] ? 1 : -1;
    } else {
      st[i]  = candles[i].c >= lower[i] ? lower[i] : upper[i];
      dir[i] = candles[i].c >= lower[i] ? -1 : 1;
    }
  }
  return dir;
}

// ─── Purple Cloud [MMD] ───────────────────────────────────────────────────────
// Direct translation of muratm82's PineScript indicator.
// Returns null if not enough data, otherwise:
//   { xs, signal, isNew, isStrong, stDir }
//   xs: 1=buy, -1=sell, 0=neutral
//   signal: 'buy' | 'sell' | 'neutral'
//   isNew: xs changed on the last bar
//   isStrong: new signal aligned with Supertrend direction
//   stDir: -1=ST bullish, 1=ST bearish
export function calcPurpleCloud(candles, x1 = 14, alpha = 0.7, bpt = 1.4, spt = 1.4) {
  const n = candles.length;
  if (n < x1 * 4) return null;

  const p4 = Math.ceil(x1 / 4); // = 4  (ceil(14/4))
  const p2 = Math.ceil(x1 / 2); // = 7  (ceil(14/2))

  const cls  = candles.map(c => c.c);
  const hl2  = candles.map(c => (c.h + c.l) / 2);
  const vol  = candles.map(c => c.v);

  // ta.vwma(hl2*vol, p) / ta.vwma(vol, p) = sum(hl2*vol², p) / sum(vol², p)
  const vol2    = vol.map(v => v * v);
  const hl2vol2 = hl2.map((h, i) => h * vol2[i]);

  const atr = calcATR(candles, x1);
  const dir = calcSupertrend(candles, 10, 3.0);

  // b1: Pine's `b1 := na(b1[1]) ? sma(close,x1) : (b1[1]*(x1-1)+close)/x1`
  // → SMA warm-up, then incremental EMA
  const b1 = new Array(n).fill(0);
  let initSum = 0;
  for (let i = 0; i < x1 && i < n; i++) initSum += cls[i];
  b1[x1 - 1] = initSum / x1;
  for (let i = x1; i < n; i++) b1[i] = (b1[i-1] * (x1 - 1) + cls[i]) / x1;

  // a3[i] = 2*a1 - a2 (DEMA-style using vol²-weighted hl2)
  const a3    = new Array(n).fill(0);
  const a3vol = new Array(n).fill(0);

  for (let i = 0; i < n; i++) {
    const sHl2v2_p4 = rsum(hl2vol2, i, p4), sV2_p4 = rsum(vol2, i, p4);
    const sHl2v2_p2 = rsum(hl2vol2, i, p2), sV2_p2 = rsum(vol2, i, p2);
    const a1 = sV2_p4 > 0 ? sHl2v2_p4 / sV2_p4 : hl2[i];
    const a2 = sV2_p2 > 0 ? sHl2v2_p2 / sV2_p2 : hl2[i];
    a3[i]    = 2 * a1 - a2;
    a3vol[i] = a3[i] * vol[i];
  }

  // xs state machine: 1=buy, -1=sell, persists last signal
  const xs = new Array(n).fill(0);

  for (let i = x1; i < n; i++) {
    if (b1[i] === 0 || atr[i] === 0) { xs[i] = xs[i-1]; continue; }

    const x2 = atr[i] * alpha;
    const xh = cls[i] + x2;
    const xl = cls[i] - x2;

    const sA3v = rsum(a3vol, i, x1);
    const sVol = rsum(vol,   i, x1);
    const a4   = sVol > 0 ? sA3v / sVol : a3[i];

    const denom = a4 + b1[i];
    const a5    = denom !== 0 ? 2 * a4 * b1[i] / denom : cls[i];

    const buy  = a5 <= xl && cls[i] > b1[i] * (1 + bpt * 0.01);
    const sell = a5 >= xh && cls[i] < b1[i] * (1 - spt * 0.01);

    xs[i] = buy ? 1 : sell ? -1 : xs[i-1];
  }

  const last  = n - 1;
  const isNew = last > 0 && xs[last] !== xs[last - 1];
  const isStrong = isNew && (
    (xs[last] ===  1 && dir[last] < 0) ||
    (xs[last] === -1 && dir[last] > 0)
  );

  return {
    xs:       xs[last],
    signal:   xs[last] === 1 ? 'buy' : xs[last] === -1 ? 'sell' : 'neutral',
    isNew,
    isStrong,
    stDir:    dir[last],
  };
}
