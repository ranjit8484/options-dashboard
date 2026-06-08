const STORAGE_KEY = 'g2_params_v2';

export const DEFAULT_PARAMS = {
  // Position limits
  maxTotalTickers:    15,
  maxPerBucket:        2,
  maxNakedPositions:   4,

  // Collateral limits (% of total account)
  warnTickerCollPct:  20,
  blockTickerCollPct: 50,
  maxBucketCollPct:   35,
  maxPortfolioPct:    80,

  // Risk per trade (% of account)
  riskFull:   10,
  riskHigh:    7,
  riskMedium:  4,
  riskLow:     2,

  // Dynamic rules
  blockNakedMoveEnabled:       true,
  blockNakedMoveThreshold:     15,
  blockOvernightGapEnabled:    true,
  blockOvernightGapThreshold:   8,

  // LEAP management
  leapHedgeWarnDays: 30,
};

export function loadParams() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PARAMS };
    return { ...DEFAULT_PARAMS, ...JSON.parse(raw) };
  } catch { return { ...DEFAULT_PARAMS }; }
}

export function saveParams(params) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(params));
  } catch {}
}

export function riskPct(conviction, params) {
  const p = params ?? DEFAULT_PARAMS;
  return {
    full:   p.riskFull   / 100,
    high:   p.riskHigh   / 100,
    medium: p.riskMedium / 100,
    low:    p.riskLow    / 100,
    none:   0,
    exit:   0,
  }[conviction] ?? 0;
}

// Collateral limit check for a given ticker
// Returns: 'block' | 'warn' | 'ok'
export function tickerCollStatus(tickerColl, totalAccount, params) {
  const p = params ?? DEFAULT_PARAMS;
  if (!totalAccount) return 'ok';
  const pct = tickerColl / totalAccount * 100;
  if (pct >= p.blockTickerCollPct) return 'block';
  if (pct >= p.warnTickerCollPct)  return 'warn';
  return 'ok';
}
