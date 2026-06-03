// Black-Scholes helpers (duplicated here to keep isolated)
function ncdf(x) {
  const a = [0.254829592,-0.284496736,1.421413741,-1.453152027,1.061405429];
  const p = 0.3275911;
  const s = x < 0 ? -1 : 1;
  const t = 1/(1+p*Math.abs(x)/Math.SQRT2);
  return 0.5*(1+s*(1-((((a[4]*t+a[3])*t+a[2])*t+a[1])*t+a[0])*t*Math.exp(-x*x/2)));
}

function bsPrice(S, K, T, r, sigma, isCall) {
  if (T <= 0) return isCall ? Math.max(0,S-K) : Math.max(0,K-S);
  const d1 = (Math.log(S/K)+(r+0.5*sigma*sigma)*T)/(sigma*Math.sqrt(T));
  const d2 = d1-sigma*Math.sqrt(T);
  return isCall
    ? S*ncdf(d1)-K*Math.exp(-r*T)*ncdf(d2)
    : K*Math.exp(-r*T)*ncdf(-d2)-S*ncdf(-d1);
}

function bsDelta(S, K, T, r, sigma, isCall) {
  if (T <= 0) return isCall ? (S>K?1:0) : (S<K?-1:0);
  const d1 = (Math.log(S/K)+(r+0.5*sigma*sigma)*T)/(sigma*Math.sqrt(T));
  return isCall ? ncdf(d1) : ncdf(d1)-1;
}

const RF = 0.045;

// IV table — same as finance.js
const IV_TABLE = {
  NVDA:0.55, SNDK:0.65, MU:0.50, AMD:0.45, ARM:0.55,
  AVGO:0.38, LRCX:0.42, ASML:0.38, SMCI:0.60, DELL:0.40,
  MSFT:0.28, GOOGL:0.30, META:0.35, AAPL:0.25, AMZN:0.32,
  ORCL:0.35, ADBE:0.38, QQQ:0.22, PLTR:0.65, COIN:0.70,
  HOOD:0.65, MSTR:0.80, HIMS:0.70, LULU:0.40, NKE:0.30,
  COST:0.22, TGT:0.38, HD:0.25, W:0.65, CMG:0.32,
  DKNG:0.55, CVNA:0.75, RIVN:0.70, CAT:0.30, NFLX:0.38,
};

export function getIV(ticker) {
  return IV_TABLE[ticker] ?? 0.40;
}

// Calculate 30-day historical volatility from candles
// candles: array of {h, l, c} objects
export function calcHV(candles, period = 30) {
  if (!candles || candles.length < period + 1) return null;
  const recent = candles.slice(-period - 1);
  const returns = [];
  for (let i = 1; i < recent.length; i++) {
    const logRet = Math.log(recent[i].c / recent[i-1].c);
    returns.push(logRet);
  }
  const mean = returns.reduce((s,r) => s+r, 0) / returns.length;
  const variance = returns.reduce((s,r) => s+(r-mean)**2, 0) / (returns.length-1);
  return Math.sqrt(variance * 252); // annualized
}

// Get IV — use HV from candles if available, else table
export function getIVFromCandles(ticker, candles) {
  if (candles?.length >= 31) {
    const hv = calcHV(candles);
    if (hv && hv > 0.05 && hv < 3.0) {
      // Apply IV premium factor (IV typically 20-40% above HV)
      return Math.min(hv * 1.3, 2.5);
    }
  }
  return IV_TABLE[ticker] ?? 0.40;
}

// Find strike at target delta using binary search
export function strikeAtDelta(spot, targetDelta, dte, iv, isCall) {
  const T = Math.max(dte, 1) / 365;
  const absDelta = Math.abs(targetDelta);
  let lo = spot * 0.3, hi = spot * 2.5;
  for (let i = 0; i < 120; i++) {
    const mid = (lo + hi) / 2;
    const d = Math.abs(bsDelta(spot, mid, T, RF, iv, isCall));
    if (d > absDelta) {
      isCall ? (lo = mid) : (hi = mid);
    } else {
      isCall ? (hi = mid) : (lo = mid);
    }
    if (hi - lo < 0.05) break;
  }
  const raw = (lo + hi) / 2;
  // Round to standard strike interval
  const step = spot > 1000 ? 25 : spot > 500 ? 10 : spot > 200 ? 5 : spot > 50 ? 2.5 : 1;
  return Math.round(raw / step) * step;
}

// Get next N standard expiry dates (Fridays)
export function getExpiries(count = 3, minDte = 5) {
  // Trading style: open 14-21 DTE, close after 7-10 days
  // Preferred window: 14-21 DTE
  // Allow down to minDte for existing positions
  const PREFERRED_MIN = 14;
  const PREFERRED_MAX = 21;

  const preferred = [];
  const fallback  = [];
  const scan = new Date();
  scan.setHours(0, 0, 0, 0);

  for (let i = 0; i < 60 && preferred.length < count; i++) {
    scan.setDate(scan.getDate() + 1);
    if (scan.getDay() !== 5) continue;
    const dte = Math.round((scan - new Date()) / 86400000);
    const entry = {
      date:      new Date(scan),
      dte,
      label:     scan.toLocaleDateString('en-US',
        { month: 'short', day: 'numeric' }),
      preferred: dte >= PREFERRED_MIN && dte <= PREFERRED_MAX
    };
    if (dte >= PREFERRED_MIN && dte <= PREFERRED_MAX) {
      preferred.push(entry);
    } else if (dte >= minDte) {
      fallback.push(entry);
    }
  }

  const combined = [...preferred, ...fallback];
  return combined.slice(0, count);
}

// Get monthly expiries for LEAPs
export function getLeapExpiries() {
  const expiries = [];
  const now = new Date();
  // Find 3rd Friday of months 3, 6, 9, 12 months out
  const targets = [3, 6, 9, 12, 18];
  targets.forEach(monthsOut => {
    const d = new Date(now);
    d.setMonth(d.getMonth() + monthsOut);
    d.setDate(1);
    // Find 3rd Friday
    let fridays = 0;
    while (fridays < 3) {
      if (d.getDay() === 5) fridays++;
      if (fridays < 3) d.setDate(d.getDate() + 1);
    }
    const dte = Math.round((d-now)/86400000);
    expiries.push({
      date: new Date(d),
      dte,
      months: monthsOut,
      label: d.toLocaleDateString('en-US',{month:'short',year:'numeric'})
    });
  });
  return expiries;
}

// Build a single trade recommendation
export function buildRec({
  spot, ticker, isCall, shortDelta, longDelta,
  dte, tradeType, account, conviction, params, ivOverride
}) {
  const iv = ivOverride ?? getIV(ticker);
  const T  = dte / 365;

  const shortStrike = strikeAtDelta(spot, shortDelta, dte, iv, isCall);
  const shortPrem   = bsPrice(spot, shortStrike, T, RF, iv, isCall);
  const actualDelta = Math.abs(bsDelta(spot, shortStrike, T, RF, iv, isCall));
  const buffer      = Math.abs(spot - shortStrike) / spot * 100;
  const breakeven   = isCall
    ? shortStrike + shortPrem
    : shortStrike - shortPrem;

  const riskKey = conviction === 'full' ? 'riskFull'
    : conviction === 'high' ? 'riskHigh'
    : conviction === 'medium' ? 'riskMedium' : 'riskLow';
  const riskPct = (params?.[riskKey] ?? 5) / 100;
  const budget  = (account ?? 0) * riskPct;

  let longStrike = null, netPrem = shortPrem, maxLoss = null, margin = 0;

  if (tradeType === 'spread' && longDelta) {
    longStrike = strikeAtDelta(spot, longDelta, dte, iv, isCall);

    // Minimum spread width by stock price
    // Ensures meaningful risk/reward structure
    const minWidth = spot < 50   ? 5
      : spot < 100  ? 5
      : spot < 200  ? 10
      : spot < 500  ? 25
      : 50;

    const rawWidth = Math.abs(shortStrike - longStrike);
    if (rawWidth < minWidth) {
      // Snap long strike to minimum width
      longStrike = isCall
        ? Math.round((shortStrike + minWidth) * 2) / 2
        : Math.round((shortStrike - minWidth) * 2) / 2;
    }

    const longPrem = bsPrice(spot, longStrike, T, RF, iv, isCall);
    netPrem  = shortPrem - longPrem;
    const width = Math.abs(shortStrike - longStrike);
    maxLoss  = (width - netPrem) * 100;
    margin   = width * 100;

    // Minimum premium filter — not worth executing
    // if premium is less than $0.50/share
    if (netPrem < 0.50) return null;
  } else {
    // Naked margin: max(20% * spot - OTM + prem, 10% * strike) * 100
    const otm = Math.max(0, isCall ? shortStrike - spot : spot - shortStrike);
    margin = Math.max(
      (0.20 * spot - otm + shortPrem) * 100,
      0.10 * shortStrike * 100
    );
  }

  const maxContracts = margin > 0 ? Math.max(1, Math.floor(budget / margin)) : 1;
  const annYield = margin > 0
    ? ((netPrem / (margin/100)) * (365/dte) * 100).toFixed(0)
    : '—';

  return {
    shortStrike, longStrike,
    premium: netPrem.toFixed(2),
    premiumTotal: Math.round(netPrem * 100),
    buffer: buffer.toFixed(1),
    breakeven: breakeven.toFixed(2),
    maxLoss: maxLoss ? Math.round(maxLoss) : null,
    margin: Math.round(margin),
    maxContracts,
    annYield,
    delta: (actualDelta * 100).toFixed(0),
    iv: (iv * 100).toFixed(0),
  };
}

// Build LEAP recommendation
export function buildLeapRec({ spot, ticker, isCall, deltaTier, dte }) {
  const iv = getIV(ticker);
  const T  = dte / 365;

  const deltaTargets = {
    aggressive:   isCall ? 0.58 : -0.58,
    moderate:     isCall ? 0.68 : -0.68,
    conservative: isCall ? 0.76 : -0.76,
  };

  return Object.entries(deltaTargets).map(([tier, delta]) => {
    const strike = strikeAtDelta(spot, Math.abs(delta), dte, iv, isCall);
    const prem   = bsPrice(spot, strike, T, RF, iv, isCall);
    const be     = isCall ? strike + prem : strike - prem;
    const beMove = ((be - spot) / spot * 100).toFixed(1);

    // Payoff at +30% and +50% move
    const target30 = spot * (isCall ? 1.30 : 0.70);
    const target50 = spot * (isCall ? 1.50 : 0.50);
    const payoff30 = Math.max(0, isCall ? target30-strike : strike-target30) - prem;
    const payoff50 = Math.max(0, isCall ? target50-strike : strike-target50) - prem;
    const ret30 = prem > 0 ? (payoff30/prem*100).toFixed(0) : '—';
    const ret50 = prem > 0 ? (payoff50/prem*100).toFixed(0) : '—';

    // Hedge cycles needed to break even
    const hedgePremPerCycle = spot * 0.025; // rough 2.5% of spot per 2wk cycle
    const cyclesNeeded = Math.ceil(prem / (hedgePremPerCycle * 0.35));

    return {
      tier, strike,
      cost: prem.toFixed(2),
      costTotal: Math.round(prem * 100),
      breakeven: be.toFixed(2),
      beMove,
      ret30, ret50,
      cyclesNeeded,
      delta: (Math.abs(bsDelta(spot, strike, T, RF, iv, isCall))*100).toFixed(0),
    };
  });
}
