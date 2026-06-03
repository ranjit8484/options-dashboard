import { useCallback, useEffect, useState } from "react";
import { calcComposite, calcEntry, calcStrategy } from "../lib/finance";

const API          = "/api/exec";
const CACHE_KEY    = "g2_signals_v10";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export const TIMEFRAMES = [
  { key: "1H",  label: "1H" },
  { key: "4H", label: "4H" },
  { key: "D", label: "D" },
  { key: "W",  label: "W"  },
];

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL_MS) return null;
    return { data, ts };
  } catch { return null; }
}

export function getSignalCacheAge() {
  try {
    const raw = localStorage.getItem('g2_signals_v10');
    if (!raw) return null;
    const { ts } = JSON.parse(raw);
    return Date.now() - ts; // ms since last cache
  } catch { return null; }
}

function saveCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
  } catch {}
}

// GScript returns candles as [t, h, l, c] arrays — convert to objects
function toCandleObjects(arr) {
  return (arr || []).map(([, h, l, c]) => ({ h, l, c }));
}

export function useSignals(tickers) {
  const [signals,  setSignals]  = useState({});
  const [loading,  setLoading]  = useState(false);
  const [cacheTs,  setCacheTs]  = useState(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  useEffect(() => {
    const cached = loadCache();
    if (cached) {
      setSignals(cached.data);
      setCacheTs(new Date(cached.ts));
    }
    // Auto-refresh if no cache or cache older than 6hrs
    // Small delay so tickers are populated first
    const timer = setTimeout(() => {
      if (tickers.length > 0) {
        const age = getSignalCacheAge();
        const isStale = age === null
          || age > (6 * 60 * 60 * 1000);
        if (isStale) fetchAll();
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, [tickers.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchAll = useCallback(async () => {
    if (!tickers.length) return;
    setLoading(true);
    setProgress({ done: 0, total: tickers.length });

    try {
      // Single request to GScript — it fetches Yahoo Finance in parallel server-side
      const url = `${API}?action=history&tickers=${tickers.join(",")}`;
      const res  = await fetch(url);
      if (!res.ok) throw new Error(`GScript HTTP ${res.status}`);
      const json = await res.json();

      if (json.error) throw new Error(json.error);

      const history = json.history ?? {};
      const computed = {};
      let done = 0;

      for (const ticker of tickers) {
        computed[ticker] = {};
        const tfData = history[ticker] ?? {};

        for (const tf of TIMEFRAMES) {
          try {
            const raw     = tfData[tf.key] ?? [];
            const candles = raw.map(c => ({ h: c[1], l: c[2], c: c[3] }));
            const sig = calcComposite(candles);
            if (sig) sig.candles = candles.slice(-60);
            const MAX_SINCE = 100;
            let since = 1;
            if (sig && candles.length > 56) {
              const currentDir = Math.sign(sig.xs);
              for (let i = candles.length - 2; i >= 55 && since < MAX_SINCE; i--) {
                const prev = calcComposite(candles.slice(0, i + 1));
                if (prev && Math.sign(prev.xs) === currentDir) {
                  since++;
                } else {
                  break;
                }
              }
            }
            computed[ticker][tf.key] = sig ? { ...sig, since } : null;
          } catch (e) {
            console.warn(`Ichimoku error ${ticker} ${tf.key}:`, e.message);
            computed[ticker][tf.key] = null;
          }
        }

        computed[ticker]._entry    = calcEntry(computed[ticker]);
        computed[ticker]._strategy = calcStrategy(computed[ticker]._entry, computed[ticker]);
        done++;
        setProgress({ done, total: tickers.length });
        setSignals(prev => ({ ...prev, [ticker]: computed[ticker] }));
      }

      saveCache(computed);
      setCacheTs(new Date());
    } catch (err) {
      console.warn("Ichimoku signal fetch failed:", err.message);
    } finally {
      setLoading(false);
    }
  }, [tickers.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  return { signals, loading, cacheTs, progress, refresh: fetchAll };
}
