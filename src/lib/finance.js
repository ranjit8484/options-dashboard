// ─── Black-Scholes ────────────────────────────────────────────────
function ncdf(x) {
  const a = [0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429];
  const p = 0.3275911;
  const s = x < 0 ? -1 : 1;
  const t = 1 / (1 + (p * Math.abs(x)) / Math.SQRT2);
  return 0.5 * (1 + s * (1 - ((((a[4] * t + a[3]) * t + a[2]) * t + a[1]) * t + a[0]) * t * Math.exp((-x * x) / 2)));
}

export function bsPrice(S, K, T, r, sigma, isCall) {
  if (T <= 0) return isCall ? Math.max(0, S - K) : Math.max(0, K - S);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  return isCall
    ? S * ncdf(d1) - K * Math.exp(-r * T) * ncdf(d2)
    : K * Math.exp(-r * T) * ncdf(-d2) - S * ncdf(-d1);
}

export function hvFromCandles(candles, period = 30) {
  if (!candles || candles.length < period + 2)
    return null;
  const recent = candles.slice(-(period + 1));
  const returns = [];
  for (let i = 1; i < recent.length; i++) {
    const prev = recent[i-1].c;
    const curr = recent[i].c;
    if (prev > 0 && curr > 0)
      returns.push(Math.log(curr / prev));
  }
  if (returns.length < period) return null;
  const mean = returns.reduce((s,r) => s+r, 0)
    / returns.length;
  const variance = returns.reduce(
    (s,r) => s + (r-mean)**2, 0
  ) / (returns.length - 1);
  const hv = Math.sqrt(variance * 252);
  // IV typically runs 20-40% above realized HV
  return Math.min(Math.max(hv * 1.3, 0.08), 2.5);
}

export const RF = 0.045;
export const IV = {
  SNDK: 0.70, MU:   0.52, LRCX: 0.38,
  NVDA: 0.48, AMD:  0.42, ARM:  0.52,
  AVGO: 0.35, ASML: 0.35, SMCI: 0.58,
  MSFT: 0.26, GOOGL:0.28, META: 0.32,
  AAPL: 0.22, AMZN: 0.30, ORCL: 0.32,
  ADBE: 0.35, NOW:  0.30, PLTR: 0.62,
  QQQ:  0.20, SPY:  0.16,
  COST: 0.26, HD:   0.24, TGT:  0.36,
  LULU: 0.38, NKE:  0.28,
  W:    0.65, COIN: 0.68, MSTR: 0.78,
  RIVN: 0.68, DKNG: 0.52, CVNA: 0.72,
  HOOD: 0.62, HIMS: 0.68,
  CAT:  0.28, NFLX: 0.36,
};

export function estPnl(ticker, dir, strike, dte,
  prem, qty, price, isSpread, longK, spreadWidth,
  ivOverride) {
  const T    = Math.max(0, dte) / 365;
  const iv   = ivOverride ?? IV[ticker] ?? 0.35;
  const isCall = dir === "lc" || dir === "sc";
  const isShort = dir === "sc" || dir === "sp";

  if (isSpread && longK && spreadWidth) {
    const shortVal  = bsPrice(price, strike, T, RF, iv, isCall);
    const longVal   = bsPrice(price, longK,  T, RF, iv, isCall);
    const spreadVal = shortVal - longVal;
    return (prem - spreadVal) * 100 * qty;
  }

  const bs = bsPrice(price, strike, T, RF, iv, isCall);
  return isShort
    ? (prem - bs) * 100 * qty
    : (bs - prem) * 100 * qty;
}

// ─── Status ───────────────────────────────────────────────────────
export function calcStatus(dir, strike, prem, price) {
  if (dir === "sc") {
    const be = strike + prem;
    return { status: price >= be ? "danger" : price >= strike ? "watch" : "safe", be, diff: price - strike };
  }
  if (dir === "sp") {
    const be = strike - prem;
    return { status: price <= be ? "danger" : price <= strike ? "watch" : "safe", be, diff: strike - price };
  }
  if (dir === "lp") return { status: price < strike ? "safe" : "watch", be: null, diff: strike - price };
  return { status: price > strike ? "safe" : "watch", be: null, diff: price - strike };
}

export function groupStatus(positions, price) {
  const order = { danger: 0, watch: 1, safe: 2 };
  return positions.reduce((worst, p) => {
    const { status } = calcStatus(p.dir, p.k, p.prem, price);
    return order[status] < order[worst] ? status : worst;
  }, "safe");
}

// ─── Collateral ───────────────────────────────────────────────────
export function calcCollateral(dir, strike, prem, qty, price) {
  if (dir === "lc" || dir === "lp") return prem * 100 * qty;
  const otm = dir === "sc" ? Math.max(0, strike - price) : Math.max(0, price - strike);
  return Math.max((0.20 * price - otm + prem) * 100 * qty, 0.10 * strike * 100 * qty);
}

// ─── Row parser ───────────────────────────────────────────────────
export function parseRows(rows) {
  const groups = {};

  rows.forEach((row, i) => {
    const ticker = row.Ticker?.trim();
    if (!ticker) return;

    const credit   = parseFloat(row["Credit / Debit"] ?? row.creditDebit ?? 0);
    const callPut  = (row["Call/Put"] ?? row.callPut ?? "").toUpperCase();
    const platform = (row.Platform ?? row.platform ?? "—").toUpperCase();
    const qty      = parseInt(row.Qty ?? row.qty ?? 1);

    const sellStrike = parseFloat(row["Sell Strike"] ?? row.sellStrike ?? 0);
    const buyStrike  = parseFloat(row["Buy Strike"]  ?? row.buyStrike  ?? 0);
    const sellExpiry = row["Sell Expiry"] ?? row.sellExpiry ?? "";
    const buyExpiry  = row["Buy Expiry"]  ?? row.buyExpiry  ?? "";

    const isSpread   = sellStrike > 0 && buyStrike > 0;
    const isCalendar = isSpread && sellExpiry && buyExpiry && sellExpiry !== buyExpiry;

    if (!groups[ticker]) groups[ticker] = { t: ticker, pos: [] };

    if (isSpread) {
      // ── Spread: single row showing both legs ─────────
      if (!sellStrike || !buyStrike || !sellExpiry) return;

      const isCredit  = credit > 0;
      const shortDir  = callPut === "CALL" ? "sc" : "sp";
      const longDir   = callPut === "CALL" ? "lc" : "lp";
      const spreadWidth = Math.abs(sellStrike - buyStrike);
      const prem      = Math.abs(credit);
      const dte       = calcDte(sellExpiry);
      const expFmt    = fmtExpiry(sellExpiry);
      const optType   = callPut === "CALL" ? "Call" : "Put";

      // Label: "950/1000 Call Spread" or "950/1000 Put Spread"
      const lbl = isCredit
        ? `${sellStrike}/${buyStrike} ${optType} Spread`
        : `${buyStrike}/${sellStrike} ${optType} Spread`;

      // For status/breakeven calc, use the short strike
      // as the primary strike — the long is the cap
      const dir = isCredit ? shortDir : longDir;
      const k   = isCredit ? sellStrike : buyStrike;

      groups[ticker].pos.push({
        id: `${ticker}-${i}`,
        lbl, dir,
        k,                          // short strike (primary)
        longK: isCredit ? buyStrike : sellStrike, // cap strike
        spreadWidth,
        exp: expFmt, dte, qty, prem,
        plat: platform,
        tradeType: row["Trade Type"] ?? "",
        isSpread: true,
        isCalendar,
        note: dte <= 2 ? "Expires soon" : null,
      });

    } else {
      const isCredit = credit > 0;
      let dir, strike, expiry;
      if (isCredit) {
        dir    = callPut === "CALL" ? "sc" : "sp";
        strike = sellStrike;
        expiry = sellExpiry;
      } else {
        dir    = callPut === "CALL" ? "lc" : "lp";
        strike = buyStrike || sellStrike;
        expiry = buyExpiry || sellExpiry;
      }

      if (!strike || !expiry) return;

      const prem   = Math.abs(credit);
      const dte    = calcDte(expiry);
      const expFmt = fmtExpiry(expiry);
      const lbl    = `${strike} ${dir === "sc" ? "Short Call" : dir === "sp" ? "Short Put" : dir === "lc" ? "Long Call" : "Long Put"}`;

      groups[ticker].pos.push({
        id: `${ticker}-${i}`,
        lbl, dir, k: strike,
        exp: expFmt, dte, qty, prem,
        plat: platform,
        tradeType: row["Trade Type"] ?? "",
        note: dte <= 2 ? "Expires soon" : null,
      });
    }
  });

  return Object.values(groups);
}

function calcDte(dateStr) {
  if (!dateStr) return 999;
  try {
    const d = new Date(dateStr);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return Math.max(0, Math.round((d - now) / 86400000));
  } catch { return 999; }
}

function fmtExpiry(dateStr) {
  try {
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()}${d.getFullYear() !== new Date().getFullYear() ? `/${String(d.getFullYear()).slice(2)}` : ""}`;
  } catch { return dateStr; }
}

// ─── EMA helper (private) ────────────────────────────────────────
function ema(closes, period) {
  const k = 2 / (period + 1);
  const out = new Array(closes.length);
  out[0] = closes[0];
  for (let i = 1; i < closes.length; i++) out[i] = closes[i] * k + out[i - 1] * (1 - k);
  return out;
}

// ─── RSI (Wilder's smoothed) ──────────────────────────────────────
export function calcRSI(candles, period = 14) {
  const n = candles.length;
  if (n < period + 1) return 50;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = candles[i].c - candles[i - 1].c;
    if (d > 0) avgGain += d; else avgLoss -= d;
  }
  avgGain /= period; avgLoss /= period;
  for (let i = period + 1; i < n; i++) {
    const d = candles[i].c - candles[i - 1].c;
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return Math.round(100 - 100 / (1 + avgGain / avgLoss));
}

// ─── MACD (12/26/9) ───────────────────────────────────────────────
export function calcMACD(candles, fast = 12, slow = 26, sigPeriod = 9) {
  const n = candles.length;
  if (n < slow + sigPeriod + 1) return { dir: 'bull', cross: null, hist: 0 };
  const closes   = candles.map(c => c.c);
  const macdLine = ema(closes, fast).map((v, i) => v - ema(closes, slow)[i]);
  const sigLine  = ema(macdLine, sigPeriod);
  const last = n - 1, prev = last - 1;
  const h  = macdLine[last] - sigLine[last];
  const ph = macdLine[prev] - sigLine[prev];
  return {
    dir:   h >= 0 ? 'bull' : 'bear',
    cross: h > 0 && ph <= 0 ? 'bull' : h < 0 && ph >= 0 ? 'bear' : null,
    hist:  h,
  };
}

// ─── Composite: Ichimoku + RSI + MACD ────────────────────────────
export function calcComposite(candles) {
  if (!candles || candles.length < 55) return null;
  const ich  = calcIchimoku(candles);
  if (!ich) return null;
  const rsi  = calcRSI(candles);
  const macd = calcMACD(candles);

  // RSI divergence: price making new high/low but
  // RSI not confirming — early reversal warning
  let rsiDivergence = false;
  if (candles.length >= 10) {
    const lookback = 10;
    const recentCandles = candles.slice(-lookback);
    const prevCandles   = candles.slice(-lookback * 2, -lookback);

    const recentHigh = Math.max(...recentCandles.map(c => c.c));
    const prevHigh   = Math.max(...prevCandles.map(c => c.c));
    const recentLow  = Math.min(...recentCandles.map(c => c.c));
    const prevLow    = Math.min(...prevCandles.map(c => c.c));

    const prevRsi = calcRSI(candles.slice(0, -lookback));

    // Bearish divergence: new price high, lower RSI
    const bearishDiv = recentHigh > prevHigh * 1.01
      && rsi < prevRsi - 5;
    // Bullish divergence: new price low, higher RSI
    const bullishDiv = recentLow < prevLow * 0.99
      && rsi > prevRsi + 5;

    rsiDivergence = bearishDiv || bullishDiv;
  }

  // Kijun distance warning: >15% from Kijun = extended
  const kijunExtended = Math.abs(ich.kijunDist ?? 0) > 15;

  return {
    ...ich, rsi, macdDir: macd.dir,
    macdCross: macd.cross, macdHist: macd.hist,
    rsiDivergence, kijunExtended,
  };
}

// ─── Entry / Exit signal ─────────────────────────────────────────
// Framework: D is primary trend. W is context — only blocks when ☄️/🚀
// opposes D. 4H drives entry timing and sell zones. 1H fine-tunes.
export function calcEntry(sigs) {
  const W  = sigs?.W;
  const D  = sigs?.D;
  const h4 = sigs?.['4H'];
  const h1 = sigs?.['1H'];
  if (!D) return { action: 'WAIT', dir: null, bounce: false };

  const dBull = D.xs >= 1;
  const dBear = D.xs <= -1;

  const wBlocksLong  = W?.xs === -2;
  const wBlocksShort = W?.xs === 2;
  const wStrong      = (dir) => dir === 'long' ? W?.xs === 2  : W?.xs === -2;
  const wConfirms    = (dir) => dir === 'long'
    ? (!W || W.xs >= 1)
    : (!W || W.xs <= -1);

  const shortTermBull = (sigs['4H']?.xs ?? 0) >= 1
    || (sigs['1H']?.xs ?? 0) >= 1;
  const shortTermBear = (sigs['4H']?.xs ?? 0) <= -1
    || (sigs['1H']?.xs ?? 0) <= -1;
  const longTermBull  = (sigs.D?.xs ?? 0) >= 1
    && (sigs.W?.xs ?? 0) >= 0;
  const longTermBear  = (sigs.D?.xs ?? 0) <= -1
    && (sigs.W?.xs ?? 0) <= 0;

  const bounce = (longTermBear && shortTermBull)
    || (longTermBull && shortTermBear);

  // EXIT: 4H reversing at extremes
  const exitLong  = dBull && h4 && (
    (h4.rsi > 76 && (h4.macdCross === 'bear' || h1?.macdCross === 'bear')) ||
    h4.rsi > 83
  );
  const exitShort = dBear && h4 && (
    (h4.rsi < 24 && (h4.macdCross === 'bull' || h1?.macdCross === 'bull')) ||
    h4.rsi < 17
  );
  if (exitLong)  return { action: 'EXIT', dir: 'long',  bounce };
  if (exitShort) return { action: 'EXIT', dir: 'short', bounce };

  // SIDEWAYS: price in cloud, RSI neutral
  const sideways = D.priceVsCloud === 'in' && D.rsi >= 38 && D.rsi <= 62;
  if (sideways) return { action: 'SIDEWAYS', dir: null, bounce };

  // SELL zone: 4H extended, trend intact, no reversal
  const sellPutZone  = h4 && h4.rsi >= 63 && h4.rsi <= 76 &&
                       h4.macdCross !== 'bear' && h1?.macdCross !== 'bear';
  const sellCallZone = h4 && h4.rsi <= 37 && h4.rsi >= 24 &&
                       h4.macdCross !== 'bull' && h1?.macdCross !== 'bull';

  // ENTER zone: 4H MACD cross + RSI has room
  const ltfBull = h4 && (h4.macdCross === 'bull' || h1?.macdCross === 'bull') &&
                  h4.rsi >= 35 && h4.rsi <= 65;
  const ltfBear = h4 && (h4.macdCross === 'bear' || h1?.macdCross === 'bear') &&
                  h4.rsi >= 35 && h4.rsi <= 65;

  if (dBull && !wBlocksLong) {
    if (ltfBull)     return { action: 'ENTER', dir: 'long',  wStrong: wStrong('long'),  wConfirms: wConfirms('long'),  bounce };
    if (sellPutZone) return { action: 'SELL',  dir: 'put',   wStrong: wStrong('long'),  wConfirms: wConfirms('long'),  bounce };
    return                   { action: 'WATCH', dir: 'long',  wStrong: wStrong('long'),  wConfirms: wConfirms('long'),  bounce };
  }

  if (dBear && !wBlocksShort) {
    if (ltfBear)      return { action: 'ENTER', dir: 'short', wStrong: wStrong('short'), wConfirms: wConfirms('short'), bounce };
    if (sellCallZone) return { action: 'SELL',  dir: 'call',  wStrong: wStrong('short'), wConfirms: wConfirms('short'), bounce };
    return                    { action: 'WATCH', dir: 'short', wStrong: wStrong('short'), wConfirms: wConfirms('short'), bounce };
  }

  if (dBull && wBlocksLong)  return { action: 'WAIT', dir: 'long',  bounce };
  if (dBear && wBlocksShort) return { action: 'WAIT', dir: 'short', bounce };
  return { action: 'WAIT', dir: null, bounce };
}

// ─── Strategy recommendation ──────────────────────────────────────
export function calcStrategy(entry, sigs) {
  if (!entry || entry.action === 'WAIT'
    || entry.action === 'EXIT') {
    const dir = entry?.dir ?? 'put';
    if (entry?.action === 'EXIT')
      return { thesis:'Exit Signal',
        label: dir==='put' ? 'Close Put' : 'Close Call',
        variant:'exit', conviction:'exit',
        description:'Signal has reversed — consider closing' };
    return {
      thesis:    'Wait — Conflicted',
      label:     'No Trade',
      variant:   'wait',
      conviction:'none',
      noTrade:   true,
      description: 'W and D disagree on direction. Sit out until both timeframes align. No trades until conflict resolves.'
    };
  }

  const W  = sigs.W?.xs  ?? 0;
  const D  = sigs.D?.xs  ?? 0;
  const Ws = sigs.W?.since ?? 0;
  const Ds = sigs.D?.since ?? 0;
  const bounce = entry.bounce ?? false;

  // Extension warning: if weekly Kijun is extended >15%
  // or RSI divergence detected, cap conviction at medium
  const wKijunExtended = sigs.W?.kijunExtended ?? false;
  const wRsiDiv        = sigs.W?.rsiDivergence ?? false;
  const dRsiDiv        = sigs.D?.rsiDivergence ?? false;
  const isExtended     = wKijunExtended || wRsiDiv || dRsiDiv;

  // Deeply oversold/overbought detection
  // Uses weekly Kijun distance as proxy for
  // 52-week position — if W price is far below
  // Kijun the stock has already had its big move
  const wKijunDist = sigs.W?.kijunDist ?? 0;

  // Stock deeply oversold = bear move largely done
  // Don't recommend aggressive bear trades
  const deepOversold   = wKijunDist < -20;

  // Stock deeply overbought = bull move largely done
  // Don't recommend aggressive bull trades
  const deepOverbought = wKijunDist > 20;

  // ── BULL signals ─────────────────────────────────────
  if (entry.dir === 'put' || entry.dir === 'long') {

    // Full conviction: W★★ + D★★
    if (W >= 2 && D >= 2) {
      if (deepOverbought)
        return {
          thesis: 'Bull Setup',
          label:  'Put Credit Spread',
          variant:'credit',
          conviction:'medium',
          noTrade: false,
          extensionWarning:
            'Stock deeply overbought — bull move largely done. ' +
            'Wait for pullback before selling puts.',
          description:
            'W🚀+D🚀 confirmed bull but stock far above ' +
            'Kijun — limited upside remains. Spread only, ' +
            'wait for a dip to sell into.'
        };
      return {
        thesis: 'Bull Premium ★',
        label:  'Sell Put Naked',
        variant:'naked',
        conviction: isExtended ? 'high' : 'full',
        noTrade: false,
        extensionWarning: isExtended
          ? 'Stock extended from Kijun or RSI diverging — reduce size'
          : null,
        description: bounce
          ? 'W🚀+D🚀 confirmed bull · short-term dip = ideal naked put entry'
          : 'W🚀+D🚀 all timeframes aligned — sell premium into strength'
      };
    }

    // High: D★★ + W★ confirmed, mature signal
    if (D >= 2 && W >= 1 && Ds > 10)
      return {
        thesis: 'Bull Premium',
        label:  'Sell Put Naked',
        variant:'naked', conviction:'high',
        noTrade: false,
        description: bounce
          ? 'D🚀 strong + W▲ confirms · bounce entry opportunity'
          : 'D🚀 strong + W▲ confirms — naked appropriate, trend supports'
      };

    // Medium-high: D★ + W★★
    if (D >= 1 && W >= 2)
      return {
        thesis: 'Bull Premium',
        label:  'Put Credit Spread',
        variant:'credit', conviction:'high',
        noTrade: false,
        description: 'W🚀 strong weekly · D▲ confirms — spread over naked'
      };

    // Medium: D★ + W neutral/weak
    if (D >= 1 && W >= 0)
      return {
        thesis: 'Bull Setup',
        label:  'Put Credit Spread',
        variant:'credit', conviction:'medium',
        noTrade: false,
        description: bounce
          ? 'D▲ bullish · W neutral · 4H/1H dipping = spread entry'
          : 'D▲ bullish · W not confirming — spread only, wait for W alignment'
      };

    // Low: D★ but W opposing
    if (D >= 1 && W < 0)
      return {
        thesis: 'Conflicted ↑',
        label:  'Put Credit Spread',
        variant:'credit', conviction:'low',
        noTrade: false,
        description: 'D▲ bullish but W▽ bearish — high risk, tight spread only'
      };

    return {
      thesis:    'Bull Watch',
      label:     'No Trade',
      variant:   'wait',
      conviction:'none',
      noTrade:   true,
      description: 'Daily signal not confirmed. Watch for D to strengthen before entering.'
    };
  }

  // ── BEAR signals ─────────────────────────────────────
  if (entry.dir === 'short') {

    // Full conviction: W☄️ + D☄️
    if (W <= -2 && D <= -2) {
      if (deepOversold)
        return {
          thesis: 'Bear Setup',
          label:  'Call Credit Spread',
          variant:'credit',
          conviction:'medium',
          noTrade: false,
          extensionWarning:
            'Stock deeply oversold — bear move largely done. ' +
            'Wait for bounce before shorting.',
          description:
            'W☄️+D☄️ confirmed bear but stock far below ' +
            'Kijun — limited downside remains. Spread only, ' +
            'wait for a bounce to sell into.'
        };
      return {
        thesis: 'Bear Premium ★',
        label:  'Sell Call Naked',
        variant:'naked',
        conviction: isExtended ? 'high' : 'full',
        noTrade: false,
        extensionWarning: isExtended
          ? 'Stock extended from Kijun or RSI diverging — reduce size'
          : null,
        description: bounce
          ? 'W☄️+D☄️ confirmed bear · short-term bounce = ideal naked call entry'
          : 'W☄️+D☄️ all timeframes aligned — sell calls into strength'
      };
    }

    // High: D☄️ + W☄️ confirmed, mature
    if (D <= -2 && W <= -1 && Ds > 10) {
      if (deepOversold)
        return {
          thesis: 'Bear Watch',
          label:  'No Trade',
          variant:'wait',
          conviction:'none',
          noTrade: true,
          description:
            'Bear signal confirmed but stock deeply ' +
            'oversold — bear move largely done. ' +
            'Wait for price to recover toward Kijun ' +
            'before considering short entry.'
        };
      return {
        thesis: 'Bear Premium',
        label:  'Sell Call Naked',
        variant:'naked', conviction:'high',
        noTrade: false,
        description: bounce
          ? 'D☄️ strong + W▽ confirms · bounce = sell call into it'
          : 'D☄️ strong + W▽ confirms — naked appropriate'
      };
    }

    // Medium-high: D▽ + W☄️
    if (D <= -1 && W <= -2)
      return {
        thesis: 'Bear Premium',
        label:  'Call Credit Spread',
        variant:'credit', conviction:'high',
        noTrade: false,
        description: 'W☄️ strong weekly · D▽ confirms — spread over naked'
      };

    // Medium: D▽ + W neutral/weak
    if (D <= -1 && W <= 0)
      return {
        thesis: 'Bear Setup',
        label:  'Call Credit Spread',
        variant:'credit', conviction:'medium',
        noTrade: false,
        description: bounce
          ? 'D▽+W▽ confirmed bear · 4H/1H bouncing = sell calls into this bounce'
          : 'D▽ bearish · W not fully confirming — spread only'
      };

    // Low: D▽ but W opposing
    if (D <= -1 && W > 0)
      return {
        thesis: 'Conflicted ↓',
        label:  'Call Credit Spread',
        variant:'credit', conviction:'low',
        noTrade: false,
        description: 'D▽ bearish but W▲ bullish — conflicted, tight spread only'
      };

    return {
      thesis:    'Bear Watch',
      label:     'No Trade',
      variant:   'wait',
      conviction:'none',
      noTrade:   true,
      description: 'Daily signal not confirmed. Watch for D to strengthen before entering.'
    };
  }

  // SIDEWAYS — explicit no trade
  return {
    thesis:    'Sideways',
    label:     'No Trade',
    variant:   'wait',
    conviction:'none',
    noTrade:   true,
    description: 'Price in cloud, no directional bias. Wait for price to break above or below cloud before entering.'
  };
}

// ─── Ichimoku Kinko Hyo ───────────────────────────────────────────
// candles: array of { h, l, c }
// Returns: { xs, signal, isNew, cloudBull, priceVsCloud, tenkan, kijun }
//   xs: 2=strong_buy, 1=buy, 0=neutral, -1=sell, -2=strong_sell
function donchianMid(candles, period, idx) {
  let hi = -Infinity, lo = Infinity;
  const start = Math.max(0, idx - period + 1);
  for (let i = start; i <= idx; i++) {
    if (candles[i].h > hi) hi = candles[i].h;
    if (candles[i].l < lo) lo = candles[i].l;
  }
  return (hi + lo) / 2;
}

export function calcIchimoku(candles) {
  const n = candles.length;
  if (n < 20) return null; // need at least 14 bars for Span B + small buffer

  const last = n - 1;
  const prev = last - 1;

  const tenkan = donchianMid(candles, 10, last);
  const kijun  = donchianMid(candles, 3,  last);

  // Current cloud: Span A & B were calculated 26 bars ago and are now plotted here
  const ci   = last - 3;
  const spanA = (donchianMid(candles, 10, ci) + donchianMid(candles, 3, ci)) / 2;
  const spanB =  donchianMid(candles, 14, ci);

  // Future cloud (direction indicator): calculated now, plotted 26 bars ahead
  const futureA = (tenkan + kijun) / 2;
  const futureB =  donchianMid(candles, 14, last);

  const close    = candles[last].c;
  const cloudTop = Math.max(spanA, spanB);
  const cloudBot = Math.min(spanA, spanB);

  const priceVsCloud = close > cloudTop ? 'above' : close < cloudBot ? 'below' : 'in';
  const cloudBull    = futureA >= futureB;

  // TK cross detection
  const prevTenkan = donchianMid(candles, 10, prev);
  const prevKijun  = donchianMid(candles, 3,  prev);
  const tkBull     = tenkan >= kijun;
  const tkCross    = tkBull !== (prevTenkan >= prevKijun);

  let xs, signal;
  if      (priceVsCloud === 'above' && cloudBull && tkBull)  { xs =  2; signal = 'strong_buy';  }
  else if (priceVsCloud === 'above')                         { xs =  1; signal = 'buy';          }
  else if (priceVsCloud === 'below' && !cloudBull && !tkBull){ xs = -2; signal = 'strong_sell'; }
  else if (priceVsCloud === 'below')                         { xs = -1; signal = 'sell';         }
  // Price inside cloud: lean on future cloud color as weak directional bias
  else if (cloudBull)                                        { xs =  1; signal = 'buy';          }
  else                                                       { xs = -1; signal = 'sell';         }

  // Kijun distance: % price is above/below Kijun
  const kijunDist = kijun > 0
    ? ((close - kijun) / kijun * 100)
    : 0;

  return { xs, signal, isNew: tkCross, cloudBull, priceVsCloud, tenkan, kijun, kijunDist };
}

// ─── Formatters ───────────────────────────────────────────────────
export const f$ = (n, d = 2) => "$" + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
export const fi$ = (n) => "$" + Math.round(Math.abs(n)).toLocaleString();
export const fk$ = (n) => n >= 1000 ? "$" + (n / 1000).toFixed(1) + "k" : "$" + Math.round(n);
