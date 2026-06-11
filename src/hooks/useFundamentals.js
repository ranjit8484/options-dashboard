const CACHE_KEY   = 'g2_fundamentals_v1';
const CONTEXT_CACHE_KEY = 'g2_context_v1';
const CONTEXT_CACHE_TTL = 60 * 60 * 1000; // 1 hour

function loadContextCache() {
  try {
    const raw = localStorage.getItem(
      CONTEXT_CACHE_KEY
    );
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const now = Date.now();
    const clean = {};
    Object.entries(parsed).forEach(([k, v]) => {
      if (now - (v._ts || 0) < CONTEXT_CACHE_TTL)
        clean[k] = v;
    });
    return clean;
  } catch { return {}; }
}

function saveContextCache(cache) {
  try {
    localStorage.setItem(
      CONTEXT_CACHE_KEY,
      JSON.stringify(cache)
    );
  } catch {}
}

async function fetchContext(ticker) {
  try {
    const res = await fetch(
      `/api/exec?action=context&tickers=${ticker}`
    );
    if (!res.ok) return null;
    const json = await res.json();
    const data = json.context?.[ticker];
    if (!data) return null;
    data._ts = Date.now();
    return data;
  } catch { return null; }
}
const CACHE_TTL   = 6 * 60 * 60 * 1000; // 6 hours

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const now = Date.now();
    // Remove expired entries
    const clean = {};
    Object.entries(parsed).forEach(([k, v]) => {
      if (now - v.ts < CACHE_TTL) clean[k] = v;
    });
    return clean;
  } catch { return {}; }
}

function saveCache(cache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

async function fetchFundamentals(ticker) {
  try {
    const res = await fetch(
      `/api/exec?action=fundamentals&tickers=${ticker}`
    );
    if (!res.ok) return null;
    const json = await res.json();
    const data = json.fundamentals?.[ticker];
    if (!data || data.error) return null;

    return {
      ticker,
      nextEarnings: data.nextEarnings ?? null,
      analysts: data.analysts ? {
        total:     data.analysts.total     ?? 0,
        bullish:   data.analysts.bullish   ?? 0,
        bearish:   data.analysts.bearish   ?? 0,
        hold:      data.analysts.hold      ?? 0,
        consensus: data.analysts.consensus ?? 'Hold',
      } : null,
      priceTarget: data.analysts?.targetMean ? {
        mean:  data.analysts.targetMean,
        high:  data.analysts.targetHigh ?? null,
        low:   data.analysts.targetLow  ?? null,
        count: data.analysts.numAnalysts ?? 0,
      } : null,
      range52: data.range52 ?? null,
      range1m: data.range1m ?? null,
      range1w: data.range1w ?? null,
      ts: Date.now(),
    };
  } catch (err) {
    console.warn('Fundamentals fetch failed:', err);
    return null;
  }
}

// ── Backdrop rating ───────────────────────────────────────────────
export function calcBackdrop(fundamentals, isBull, currentPrice) {
  if (!fundamentals) return null;

  const { nextEarnings, analysts, priceTarget, range52 } = fundamentals;
  const price = currentPrice || fundamentals.currentPrice;

  const warnings  = [];
  const supports  = [];
  let   score     = 0;

  // ── 52-week range position ────────────────────────
  if (range52 && price) {
    const rangeSize   = range52.high - range52.low;
    const position    = rangeSize > 0
      ? (price - range52.low) / rangeSize : 0.5;
    const pctFrom52High = ((range52.high - price) / range52.high * 100);
    const pctFrom52Low  = ((price - range52.low)  / range52.low  * 100);
    const positionPct   = Math.round(position * 100);

    if (!isBull && pctFrom52High < 5) {
      warnings.push(
        `Within ${pctFrom52High.toFixed(1)}% of 52-week high $${range52.high.toLocaleString()} — extreme for bearish`
      );
      score -= 3;
    } else if (!isBull && position > 0.75) {
      warnings.push(
        `At ${positionPct}% of 52-week range — elevated, bearish carries more risk`
      );
      score -= 1;
    } else if (!isBull && position < 0.4) {
      supports.push(
        `At ${positionPct}% of 52-week range — lower half, bearish supported`
      );
      score += 2;
    } else if (isBull && pctFrom52Low < 10) {
      supports.push(
        `Near 52-week low — potential value entry for bullish`
      );
      score += 2;
    } else if (isBull && position > 0.85) {
      warnings.push(
        `At ${positionPct}% of 52-week range — near yearly high, limited upside`
      );
      score -= 1;
    } else if (isBull && position < 0.6) {
      supports.push(
        `At ${positionPct}% of 52-week range — mid-range, room to run`
      );
      score += 1;
    }
  }

  // ── Earnings proximity ────────────────────────────
  if (nextEarnings) {
    if (nextEarnings.dte <= 7) {
      warnings.push(
        `Earnings in ${nextEarnings.dte}d — high risk, avoid new positions`
      );
      score -= 3;
    } else if (nextEarnings.dte <= 14) {
      warnings.push(
        `Earnings in ${nextEarnings.dte}d — elevated IV, size down`
      );
      score -= 1;
    } else if (nextEarnings.dte <= 30) {
      warnings.push(`Earnings in ${nextEarnings.dte}d — watch`);
      score -= 0.5;
    } else {
      supports.push(
        `Earnings ${nextEarnings.dte}d away — safe window ✓`
      );
      score += 1;
    }
  }

  // ── Analyst data ──────────────────────────────────
  if (analysts && analysts.total > 0) {
    const bullPct = analysts.bullish / analysts.total;
    if (isBull && bullPct >= 0.6) {
      supports.push(
        `${analysts.bullish}/${analysts.total} analysts bullish — confirms long`
      );
      score += 2;
    } else if (isBull && bullPct < 0.3) {
      warnings.push(
        `Only ${analysts.bullish}/${analysts.total} analysts bullish`
      );
      score -= 1;
    } else if (!isBull && bullPct >= 0.7) {
      warnings.push(
        `${analysts.bullish}/${analysts.total} analysts bullish — against bearish`
      );
      score -= 2;
    } else if (!isBull && bullPct < 0.4) {
      supports.push(
        `${analysts.bearish}/${analysts.total} analysts bearish — confirms short`
      );
      score += 2;
    }
  }

  // ── Price target ──────────────────────────────────
  if (priceTarget?.mean && price) {
    const upside = (priceTarget.mean - price) / price * 100;
    if (isBull && upside > 15) {
      supports.push(
        `Analyst target $${priceTarget.mean.toLocaleString()} = +${Math.round(upside)}% upside`
      );
      score += 2;
    } else if (isBull && upside < 5) {
      warnings.push(
        `Near analyst target $${priceTarget.mean.toLocaleString()} — limited upside`
      );
      score -= 1;
    } else if (!isBull && upside < -5) {
      supports.push(
        `Above analyst target — overvalued`
      );
      score += 2;
    } else if (!isBull && upside > 20) {
      warnings.push(
        `Analyst target +${Math.round(upside)}% above current — against bearish`
      );
      score -= 2;
    }
  }

  // ── Final rating ──────────────────────────────────
  const rating = score >= 3  ? 'STRONG'
    : score >= 1  ? 'SUPPORTS'
    : score >= -1 ? 'NEUTRAL'
    : score >= -3 ? 'CAUTION'
    :               'AGAINST';

  return {
    rating,
    score,
    warnings,
    supports,
    nextEarnings,
    analysts,
    priceTarget,
    range52,
    positionPct: range52 && price
      ? Math.round(
          (price - range52.low) / (range52.high - range52.low) * 100
        )
      : null,
  };
}

// ── React hook ────────────────────────────────────────────────────
import { useState, useEffect } from 'react';

export function useFundamentals(ticker) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!ticker) return;
    let cancelled = false;

    async function load() {
      // Check cache first
      const cache = loadCache();
      if (cache[ticker]) {
        setData(cache[ticker]);
        return;
      }

      setLoading(true);
      const result = await fetchFundamentals(ticker);
      if (!cancelled && result) {
        const updated = { ...loadCache(), [ticker]: result };
        saveCache(updated);
        setData(result);
      }
      if (!cancelled) setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [ticker]);

  return { data, loading };
}

export function useContext(ticker) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!ticker) return;
    let cancelled = false;

    async function load() {
      // Check cache first
      const cache = loadContextCache();
      if (cache[ticker]) {
        setData(cache[ticker]);
        return;
      }
      setLoading(true);
      const result = await fetchContext(ticker);
      if (!cancelled && result) {
        const updated = {
          ...loadContextCache(),
          [ticker]: result
        };
        saveContextCache(updated);
        setData(result);
      }
      if (!cancelled) setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [ticker]);

  return { data, loading };
}
