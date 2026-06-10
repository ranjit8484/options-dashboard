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
export function calcCollateral(dir, strike, prem, qty, price, spreadWidth, coveredByLeap, leapCost, diagonalWidth) {
  // Long options: cost basis is the collateral
  if (dir === "lc" || dir === "lp") return prem * 100 * qty;

  // Diagonal (PMCC/PMCP): short is covered by LEAP
  // Collateral = LEAP cost already paid (no extra margin)
  // Because the LEAP IS the collateral
  if (coveredByLeap && leapCost) return 0;

  // Same-expiry spread: max loss = width minus premium
  if (spreadWidth && spreadWidth > 0) {
    return Math.max(0, (spreadWidth - prem) * 100 * qty);
  }

  // Naked: standard margin formula
  const otm = dir === "sc"
    ? Math.max(0, strike - price)
    : Math.max(0, price - strike);
  return Math.max(
    (0.20 * price - otm + prem) * 100 * qty,
    0.10 * strike * 100 * qty
  );
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
        openDate: row["Open Date"] ?? null,
        isSpread: true,
        isCalendar,
        note: dte <= 2 ? "Expires soon" : null,
      });

    } else {
      const isCredit = credit > 0;
      const tradeTypeLower = (row["Trade Type"] ?? "").toLowerCase();
      const isLeapByType = tradeTypeLower === "leap call"
        || tradeTypeLower === "leap put";
      let dir, strike, expiry;
      if (isLeapByType) {
        // Force long direction regardless of credit sign
        dir    = (tradeTypeLower === "leap call" || callPut === "CALL") ? "lc" : "lp";
        strike = buyStrike || sellStrike;
        expiry = buyExpiry || sellExpiry;
      } else if (isCredit) {
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
        openDate: row["Open Date"] ?? null,
        note: dte <= 2 ? "Expires soon" : null,
      });
    }
  });

  // ── Detect diagonal pairs (PMCC/PMCP) ──────────────
  // A diagonal is: long option + short option
  // same ticker, same type (both calls or both puts)
  // long expiry > short expiry
  // long strike further ITM than short strike
  // The short is COVERED by the long — not naked
  Object.values(groups).forEach(g => {
    const longs  = g.pos.filter(p => p.dir === 'lc' || p.dir === 'lp');
    const shorts = g.pos.filter(p => p.dir === 'sc' || p.dir === 'sp');

    longs.forEach(long => {
      const isLongCall = long.dir === 'lc';
      // Find matching short: same type, shorter expiry, covered strike
      const match = shorts.find(short => {
        if (short.isDiagonal) return false; // already matched
        const isShortCall = short.dir === 'sc';
        if (isLongCall !== isShortCall) return false; // must match type
        // Long must expire after short
        const longDte  = long.dte  ?? 999;
        const shortDte = short.dte ?? 0;
        if (longDte <= shortDte) return false;
        // For calls: long strike <= short strike (long covers short)
        // For puts:  long strike <= short strike (long is below short)
        if (isLongCall && long.k > short.k) return false;
        if (!isLongCall && long.k > short.k) return false;
        return true;
      });

      if (match) {
        long.isDiagonal  = true;
        long.diagonalPair = match.id;
        match.isDiagonal  = true;
        match.diagonalPair = long.id;
        match.coveredByLeap = true;
        match.leapCost = long.prem * 100 * (long.qty || 1);
        match.leapStrike = long.k;
        // Spread width for diagonal = short strike - long strike
        match.diagonalWidth = Math.abs(match.k - long.k);
      }
    });
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

// ─── Phase Detection ──────────────────────────────────────────────
// Detects which phase of the market cycle a stock is in
// Returns phase object used by calcCompositeScore and ResearchCard
export function calcPhase({ sig, fundamentals, spot }) {
  if (!sig || !spot) return null;

  const W      = sig.W;
  const D      = sig.D;
  const wXs    = W?.xs    ?? 0;
  const dXs    = D?.xs    ?? 0;
  const wSince = W?.since ?? 0;
  const wKijun = W?.kijunDist ?? 0;
  const wRsiDiv = W?.rsiDivergence ?? false;
  const dRsiDiv = D?.rsiDivergence ?? false;

  const dir = wXs >= 1 ? 'bull' : wXs <= -1 ? 'bear' : 'neutral';

  let rangePos = null;
  if (fundamentals?.range52 && spot) {
    const { low, high } = fundamentals.range52;
    const range = high - low;
    if (range > 0) rangePos = (spot - low) / range;
  }

  const absKijun    = Math.abs(wKijun);
  const rsiDiverge  = wRsiDiv || dRsiDiv;
  const wdAligned   = (wXs >= 1 && dXs >= 1) || (wXs <= -1 && dXs <= -1);

  // ── Phase 4: EXHAUSTION — check first, highest priority ──
  const rangeExhausted = rangePos !== null && (
    (dir === 'bull' && rangePos > 0.80) ||
    (dir === 'bear' && rangePos < 0.20)
  );
  const kijunExhausted = absKijun > 20;
  if (rangeExhausted || kijunExhausted) {
    const reason = rangeExhausted
      ? `Price at ${Math.round((rangePos??0)*100)}% of 52wk range — move largely done`
      : `${wKijun > 0 ? '+' : ''}${wKijun.toFixed(1)}% from Kijun — dangerously extended`;
    return {
      phase: 4,
      label: 'EXHAUSTION',
      emoji: '🔴',
      color: 'red',
      reason,
      action: 'DO NOT ENTER — move overdone',
      probeAllowed: false,
      tradeSize: 'none',
    };
  }

  // ── Phase 1: ACCUMULATION — near lows/highs, signal weak/new ──
  const nearExtreme = rangePos !== null && (
    (dir === 'bear' && rangePos < 0.15) ||
    (dir === 'bull' && rangePos < 0.15)
  );
  const signalNew = wSince <= 2;
  if (nearExtreme && signalNew) {
    return {
      phase: 1,
      label: 'ACCUMULATION',
      emoji: '🔵',
      color: 'blue',
      reason: nearExtreme
        ? `Price at ${Math.round((rangePos??0)*100)}% of range — potential base forming`
        : 'Signal very new, price near Kijun — early stage',
      action: 'Probe trade only — small debit spread to test direction',
      probeAllowed: true,
      tradeSize: 'probe',
      probeTrade: dir === 'bull'
        ? 'Small call debit spread — $1-2 max loss per share'
        : 'Small put debit spread — $1-2 max loss per share',
    };
  }

  // ── Phase 5: DISTRIBUTION/REVERSAL — fresh counter signal ──
  const freshReversal = wSince >= 1 && wSince <= 4;
  const rangeHighForBear = rangePos !== null && dir === 'bear' && rangePos > 0.60;
  const rangeLowForBull  = rangePos !== null && dir === 'bull' && rangePos > 0.55;
  if (freshReversal && (rangeHighForBear || rangeLowForBull)) {
    return {
      phase: 5,
      label: 'REVERSAL',
      emoji: '🟠',
      color: 'orange',
      reason: `Fresh ${dir === 'bear' ? 'bear' : 'bull'} signal at ${Math.round((rangePos??0)*100)}% of range — potential trend change`,
      action: 'Early reversal entry — spread only, confirm with D alignment',
      probeAllowed: true,
      tradeSize: 'small',
    };
  }

  // ── Phase 2: EARLY TREND — fresh signal, good range, aligned ──
  const goodRange = rangePos !== null && (
    (dir === 'bear' && rangePos >= 0.35 && rangePos <= 0.75) ||
    (dir === 'bull' && rangePos >= 0.25 && rangePos <= 0.65)
  );
  const signalFresh = wSince >= 2 && wSince <= 7;
  if (signalFresh && wdAligned && (goodRange || rangePos === null)) {
    return {
      phase: 2,
      label: 'EARLY TREND',
      emoji: '🟢',
      color: 'green',
      reason: `Fresh W signal (${wSince} candles), W+D aligned — trend just starting`,
      action: 'Standard spread entry — best risk/reward window',
      probeAllowed: false,
      tradeSize: 'normal',
    };
  }

  // ── Phase 3: MOMENTUM — established signal, good range ──
  const signalEstablished = wSince > 7 && wSince <= 30;
  if (signalEstablished && wdAligned) {
    const rsiCaution = rsiDiverge
      ? ' — RSI diverging, reduce size' : '';
    return {
      phase: 3,
      label: 'MOMENTUM',
      emoji: '🟡',
      color: 'yellow',
      reason: `W signal ${wSince} candles — established trend running${rsiCaution}`,
      action: rsiDiverge
        ? 'Spread only, half size — RSI diverging, momentum weakening'
        : wSince <= 15
        ? 'Full size spread or naked if conviction high'
        : 'Spread only — trend maturing, reduce size slightly',
      probeAllowed: false,
      tradeSize: rsiDiverge ? 'reduced' : wSince <= 15 ? 'full' : 'reduced',
      rsiCaution: rsiDiverge,
    };
  }

  // ── Default: signal not clear enough ──
  return {
    phase: 0,
    label: 'UNCLEAR',
    emoji: '⚪',
    color: 'grey',
    reason: 'Signal alignment insufficient for phase classification',
    action: 'Wait for clearer W+D alignment',
    probeAllowed: false,
    tradeSize: 'none',
  };
}

// ─── Composite Score ──────────────────────────────────────────────
export function calcCompositeScore({
  sig, fundamentals, spot, marketSig
}) {
  if (!sig || !spot) return null;
  const phase = calcPhase({ sig, fundamentals, spot });

  const W   = sig.W;
  const D   = sig.D;
  const h4  = sig['4H'];
  const h1  = sig['1H'];

  const wXs    = W?.xs    ?? 0;
  const dXs    = D?.xs    ?? 0;
  const wSince = W?.since ?? 0;
  const dSince = D?.since ?? 0;
  const wRsi   = W?.rsi   ?? 50;
  const dRsi   = D?.rsi   ?? 50;
  const wKijun = W?.kijunDist ?? 0;
  const dKijun = D?.kijunDist ?? 0;
  const wRsiDiv = W?.rsiDivergence ?? false;
  const dRsiDiv = D?.rsiDivergence ?? false;
  const h4Xs   = h4?.xs ?? 0;
  const h1Xs   = h1?.xs ?? 0;

  const isBull = wXs >= 1 || dXs >= 1;
  const isBear = wXs <= -1 || dXs <= -1;
  const dir    = wXs >= 1 ? 'bull'
    : wXs <= -1 ? 'bear' : 'neutral';

  // ── 1. Range Position Score (0-25) ──────────────
  let rangeScore = 12;
  let rangePos   = null;
  let rangeFlag  = null;

  if (fundamentals?.range52 && spot) {
    const { low, high } = fundamentals.range52;
    const range = high - low;
    if (range > 0) {
      rangePos = (spot - low) / range;

      if (dir === 'bull') {
        if (rangePos > 0.80) {
          rangeScore = 0;
          rangeFlag  = {
            level: 'BLOCK',
            msg: `At ${Math.round(rangePos*100)}% of 52wk range — near highs. Bull move largely done. DO NOT chase.`
          };
        } else if (rangePos > 0.65) {
          rangeScore = 5;
          rangeFlag  = {
            level: 'WARN',
            msg: `At ${Math.round(rangePos*100)}% of 52wk range — extended. Spread only, half size.`
          };
        } else if (rangePos >= 0.20 && rangePos <= 0.60) {
          rangeScore = 25;
          rangeFlag  = {
            level: 'GOOD',
            msg: `At ${Math.round(rangePos*100)}% of 52wk range — ideal bull entry zone.`
          };
        } else if (rangePos < 0.20) {
          rangeScore = 20;
          rangeFlag  = {
            level: 'OK',
            msg: `At ${Math.round(rangePos*100)}% of 52wk range — near lows, value entry.`
          };
        } else {
          rangeScore = 15;
        }
      } else if (dir === 'bear') {
        if (rangePos < 0.20) {
          rangeScore = 0;
          rangeFlag  = {
            level: 'BLOCK',
            msg: `At ${Math.round(rangePos*100)}% of 52wk range — near lows. Bear move largely done. DO NOT short.`
          };
        } else if (rangePos < 0.35) {
          rangeScore = 5;
          rangeFlag  = {
            level: 'WARN',
            msg: `At ${Math.round(rangePos*100)}% of 52wk range — oversold. Spread only, half size.`
          };
        } else if (rangePos >= 0.40 && rangePos <= 0.80) {
          rangeScore = 25;
          rangeFlag  = {
            level: 'GOOD',
            msg: `At ${Math.round(rangePos*100)}% of 52wk range — ideal bear entry zone.`
          };
        } else if (rangePos > 0.80) {
          rangeScore = 20;
          rangeFlag  = {
            level: 'OK',
            msg: `At ${Math.round(rangePos*100)}% of 52wk range — near highs, good short zone.`
          };
        } else {
          rangeScore = 15;
        }
      }
    }
  }

  // ── 1b. Range Velocity Penalty ──────────────────
  // If signal is very mature AND price is extended
  // likely a late entry — penalize score
  // Uses wSince as proxy for how long move has run
  let velocityPenalty = 0;
  let velocityFlag    = null;
  if (rangePos !== null && wSince > 20) {
    if (dir === 'bull' && rangePos > 0.65) {
      velocityPenalty = 15;
      velocityFlag    = `W signal ${wSince} candles + extended range — late entry, move likely mature`;
    } else if (dir === 'bear' && rangePos < 0.35) {
      velocityPenalty = 15;
      velocityFlag    = `W signal ${wSince} candles + oversold range — late entry, move likely mature`;
    }
  }
  // Additional penalty for very mature signals at extremes
  if (rangePos !== null && wSince > 30) {
    if (dir === 'bull' && rangePos > 0.55) {
      velocityPenalty = Math.max(velocityPenalty, 20);
      velocityFlag    = `W signal ${wSince} candles — trend exhaustion very likely`;
    } else if (dir === 'bear' && rangePos < 0.45) {
      velocityPenalty = Math.max(velocityPenalty, 20);
      velocityFlag    = `W signal ${wSince} candles — trend exhaustion very likely`;
    }
  }

  // ── 2. Signal Alignment Score (0-30) ────────────
  let alignScore = 0;
  let alignFlag  = null;

  const wdAligned = (wXs >= 1 && dXs >= 1)
    || (wXs <= -1 && dXs <= -1);
  const wStrong = Math.abs(wXs) >= 2;
  const dStrong = Math.abs(dXs) >= 2;

  if (wStrong && dStrong && wdAligned) {
    alignScore = 30;
    alignFlag  = 'W★★ + D★★ — full conviction';
  } else if (wdAligned && (wStrong || dStrong)) {
    alignScore = 22;
    alignFlag  = 'W+D aligned — high conviction';
  } else if (wdAligned) {
    alignScore = 15;
    alignFlag  = 'W+D aligned — medium conviction';
  } else if (Math.abs(dXs) >= 1) {
    alignScore = 7;
    alignFlag  = 'D signal only — W not confirming';
  } else {
    alignScore = 0;
    alignFlag  = 'No clear signal';
  }

  // ── 3. Signal Maturity Score (0-20) ─────────────
  let maturityScore = 0;
  let maturityFlag  = null;

  if (wSince >= 3 && wSince <= 10) {
    maturityScore = 20;
    maturityFlag  = `W signal ${wSince} candles — fresh, ideal entry`;
  } else if (wSince > 10 && wSince <= 20) {
    maturityScore = 14;
    maturityFlag  = `W signal ${wSince} candles — established`;
  } else if (wSince > 20 && wSince <= 35) {
    maturityScore = 7;
    maturityFlag  = `W signal ${wSince} candles — maturing, reduce size`;
  } else if (wSince > 35) {
    maturityScore = 0;
    maturityFlag  = `W signal ${wSince} candles — very mature, trend exhaustion likely`;
  } else {
    maturityScore = 5;
    maturityFlag  = `W signal very new — wait for confirmation`;
  }

  // ── 4. Market Alignment Score (0-15) ────────────
  let marketScore = 7;
  let marketFlag  = null;

  if (marketSig) {
    const qXs  = marketSig.W?.xs ?? 0;
    const qdXs = marketSig.D?.xs ?? 0;

    if (dir === 'bull') {
      if (qXs >= 1 && qdXs >= 1) {
        marketScore = 15;
        marketFlag  = 'QQQ bullish — market supports long';
      } else if (qXs >= 1 || qdXs >= 1) {
        marketScore = 10;
        marketFlag  = 'QQQ partially bullish';
      } else if (qXs <= -1 && qdXs <= -1) {
        marketScore = 0;
        marketFlag  = 'QQQ bearish — market opposes long trades';
      } else {
        marketScore = 5;
        marketFlag  = 'QQQ neutral — no market tailwind';
      }
    } else if (dir === 'bear') {
      if (qXs <= -1 && qdXs <= -1) {
        marketScore = 15;
        marketFlag  = 'QQQ bearish — market supports shorts';
      } else if (qXs <= -1 || qdXs <= -1) {
        marketScore = 10;
        marketFlag  = 'QQQ partially bearish';
      } else if (qXs >= 1 && qdXs >= 1) {
        marketScore = 0;
        marketFlag  = 'QQQ bullish — market opposes short trades';
      } else {
        marketScore = 5;
        marketFlag  = 'QQQ neutral';
      }
    }
  } else {
    marketFlag = 'QQQ not available';
  }

  // ── 5. Extension / Kijun Score (0-10) ───────────
  let extScore = 10;
  let extFlag  = null;

  const absKijun = Math.abs(wKijun);
  if (absKijun > 25) {
    extScore = 0;
    extFlag  = `${wKijun > 0 ? '+' : ''}${wKijun.toFixed(1)}% from W Kijun — dangerously extended`;
  } else if (absKijun > 15) {
    extScore = 4;
    extFlag  = `${wKijun > 0 ? '+' : ''}${wKijun.toFixed(1)}% from W Kijun — extended, caution`;
  } else if (absKijun > 8) {
    extScore = 7;
    extFlag  = `${wKijun > 0 ? '+' : ''}${wKijun.toFixed(1)}% from W Kijun — slightly extended`;
  } else {
    extFlag  = `${wKijun > 0 ? '+' : ''}${wKijun.toFixed(1)}% from W Kijun — within normal range`;
  }

  // ── 6. RSI Divergence Penalty ───────────────────
  let rsiPenalty = 0;
  let rsiFlag    = null;

  if (wRsiDiv && dRsiDiv) {
    rsiPenalty = 15;
    rsiFlag    = 'RSI divergence on both W and D — strong reversal warning';
  } else if (wRsiDiv || dRsiDiv) {
    rsiPenalty = 8;
    rsiFlag    = 'RSI divergence detected — momentum weakening';
  }

  // ── 7. MACD Confirmation Bonus ──────────────────
  let macdBonus = 0;
  let macdFlag  = null;

  const dMacd = D?.macdDir;
  if (dir === 'bull' && dMacd === 'bull') {
    macdBonus = 5;
    macdFlag  = 'MACD confirming bullish — momentum aligned';
  } else if (dir === 'bear' && dMacd === 'bear') {
    macdBonus = 5;
    macdFlag  = 'MACD confirming bearish — momentum aligned';
  } else if (dMacd) {
    macdBonus = -3;
    macdFlag  = 'MACD opposing signal direction — caution';
  }

  // ── 8. Earnings Penalty ─────────────────────────
  let earningsPenalty = 0;
  let earningsFlag    = null;

  if (fundamentals?.nextEarnings) {
    const dte = fundamentals.nextEarnings.dte;
    const lbl = fundamentals.nextEarnings.label;
    if (dte <= 3) {
      earningsPenalty = 25;
      earningsFlag    = `EARNINGS ${dte === 0 ? 'TODAY' : dte === 1 ? 'TOMORROW' : `IN ${dte} DAYS`} (${lbl}) — DO NOT TRADE`;
    } else if (dte <= 7) {
      earningsPenalty = 15;
      earningsFlag    = `Earnings in ${dte}d (${lbl}) — high binary risk, half size max`;
    } else if (dte <= 14) {
      earningsPenalty = 7;
      earningsFlag    = `Earnings in ${dte}d (${lbl}) — elevated IV, size down`;
    }
  }

  // ── Final Score ──────────────────────────────────
  const raw = rangeScore + alignScore + maturityScore
    + marketScore + extScore + macdBonus
    - rsiPenalty - earningsPenalty - velocityPenalty;
  const score = Math.max(0, Math.min(100, raw));

  // ── Tier ────────────────────────────────────────
  let tier, tierLabel, tierColor, recommendation;

  if (rangeFlag?.level === 'BLOCK') {
    tier      = 'BLOCK';
    tierColor = 'red';
    if (dir === 'bull' && rangePos > 0.80) {
      tierLabel = '🚫 Bull Exhausted — Counter-trend available';
      recommendation = 'Bull move done. Consider BEAR call spread as counter-trend probe. Stock at highs with limited upside.';
    } else if (dir === 'bear' && rangePos < 0.20) {
      tierLabel = '🚫 Bear Exhausted — Counter-trend available';
      recommendation = 'Bear move done. Consider BULL put spread as counter-trend probe. Stock at lows with limited downside.';
    } else {
      tierLabel = dir === 'bull'
        ? '🚫 DO NOT TRADE — Bull Exhausted'
        : '🚫 DO NOT TRADE — Bear Exhausted';
      recommendation = dir === 'bull'
        ? 'Stock near 52-week highs. Bull move is done. Wait for reversal signal.'
        : 'Stock near 52-week lows. Bear move is done. Wait for recovery signal.';
    }
  } else if (earningsPenalty >= 25) {
    tier         = 'BLOCK';
    tierLabel    = '🚫 DO NOT TRADE — Earnings Imminent';
    tierColor    = 'red';
    recommendation = earningsFlag;
  } else if (score >= 75) {
    tier      = 'PRIME';
    tierColor = 'green';
    if (phase?.phase === 4) {
      tierLabel = `🔴 HIGH SCORE — ${phase.emoji} ${phase.label}`;
      tierColor = 'red';
      recommendation = phase.action;
    } else if (phase?.phase === 1) {
      tierLabel = `🔵 PRIME — ${phase.emoji} ${phase.label}`;
      recommendation = phase.action;
    } else {
      const phaseLabel = phase ? ` — ${phase.emoji} ${phase.label}` : '';
      tierLabel = `🟢 PRIME SETUP${phaseLabel}`;
      recommendation = phase?.action
        ?? 'All conditions aligned. Fresh signal, good range position. Enter full size.';
    }
  } else if (score >= 55) {
    tier      = 'GOOD';
    tierColor = 'green';
    if (phase?.phase === 4) {
      tierLabel = `⚠ GOOD SCORE — ${phase.emoji} ${phase.label}`;
      tierColor = 'amber';
      recommendation = phase.action;
    } else if (phase?.phase === 1) {
      tierLabel = `🔵 GOOD — ${phase.emoji} ${phase.label}`;
      recommendation = phase.action;
    } else {
      const phaseLabel = phase ? ` — ${phase.emoji} ${phase.label}` : '';
      tierLabel = `📍 GOOD SETUP${phaseLabel}`;
      recommendation = phase?.action
        ?? 'Strong setup. Most conditions met. Enter spread at normal size.';
    }
  } else if (score >= 40) {
    tier         = 'MARGINAL';
    tierLabel    = '⏳ MARGINAL — Small Size Only';
    tierColor    = 'amber';
    recommendation = 'Mixed signals. If trading, use small defined-risk spread only. Half size maximum.';
  } else if (score >= 20) {
    tier         = 'WEAK';
    tierLabel    = '⚠ WEAK — Watch Only';
    tierColor    = 'amber';
    recommendation = 'Too many conditions not met. Watch for improvement. No trade now.';
  } else {
    tier         = 'AVOID';
    tierLabel    = '🔴 AVOID — No Trade';
    tierColor    = 'red';
    recommendation = 'Signal quality too low. Multiple blocking conditions. Sit this one out completely.';
  }

  // ── What To Watch For ───────────────────────────
  let watchFor = null;
  if (tier === 'BLOCK' || tier === 'AVOID' || tier === 'WEAK') {
    if (dir === 'bull' && rangePos > 0.75) {
      watchFor = 'Watch for: D turns bearish (▽) → stock corrects → re-enter bull at lower price';
    } else if (dir === 'bear' && rangePos < 0.25) {
      watchFor = 'Watch for: D turns bullish (▲) → confirms recovery → then assess bear entry higher';
    } else if (wSince > 30) {
      watchFor = `Watch for: W signal resets (since drops to 0) → fresh entry opportunity`;
    } else if (earningsPenalty > 0) {
      watchFor = `Watch for: Post-earnings direction. Enter after gap settles (1-2 days post earnings).`;
    }
  }

  return {
    score,
    tier,
    tierLabel,
    tierColor,
    recommendation,
    watchFor,
    phase,
    rangePos,
    rangeFlag,
    velocityFlag,
    alignFlag,
    maturityFlag,
    marketFlag,
    extFlag,
    rsiFlag,
    macdFlag,
    earningsFlag,
    breakdown: {
      range:      rangeScore,
      align:      alignScore,
      maturity:   maturityScore,
      market:     marketScore,
      ext:        extScore,
      macd:       macdBonus,
      rsiPenalty: -rsiPenalty,
      earnings:   -earningsPenalty,
    }
  };
}

// ─── Formatters ───────────────────────────────────────────────────
export const f$ = (n, d = 2) => "$" + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
export const fi$ = (n) => "$" + Math.round(Math.abs(n)).toLocaleString();
export const fk$ = (n) => n >= 1000 ? "$" + (n / 1000).toFixed(1) + "k" : "$" + Math.round(n);
