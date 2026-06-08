import { useCallback, useEffect, useState } from "react";
import { parseRows } from "../lib/finance";

const FINNHUB_KEY = import.meta.env.VITE_FINNHUB_KEY;

// Shared in-memory cache — survives across components
// but resets on page reload
const _priceCache = {};
const _inFlight   = {};
const CACHE_TTL   = 5 * 60 * 1000; // 5 minutes

async function fetchLivePrices(tickers) {
  if (!FINNHUB_KEY) {
    console.warn("No Finnhub key set");
    return {};
  }

  const now     = Date.now();
  const results = {};
  const toFetch = [];

  // Return cached prices, collect stale ones to fetch
  for (const ticker of tickers) {
    const cached = _priceCache[ticker];
    if (cached && (now - cached.ts) < CACHE_TTL) {
      results[ticker] = cached.price;
    } else {
      toFetch.push(ticker);
    }
  }

  if (toFetch.length === 0) return results;

  // Deduplicate in-flight requests
  // If another component is already fetching this ticker, wait for it
  for (const ticker of toFetch) {
    if (_inFlight[ticker]) {
      try {
        const price = await _inFlight[ticker];
        if (price) results[ticker] = price;
      } catch {}
      continue;
    }

    // Create a promise for this fetch so others can share it
    _inFlight[ticker] = (async () => {
      try {
        const res = await fetch(
          `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB_KEY}`
        );
        if (res.status === 429) {
          console.warn(`Finnhub 429 on ${ticker} — using cached price`);
          return _priceCache[ticker]?.price ?? null;
        }
        const json = await res.json();
        if (json.c > 0) {
          _priceCache[ticker] = { price: json.c, ts: Date.now() };
          return json.c;
        }
        return null;
      } catch {
        return _priceCache[ticker]?.price ?? null;
      } finally {
        delete _inFlight[ticker];
      }
    })();

    try {
      const price = await _inFlight[ticker];
      if (price) results[ticker] = price;
    } catch {}

    // 700ms between requests to stay under 60/min limit
    await new Promise(r => setTimeout(r, 700));
  }

  return results;
}

// Expose cache for debugging
export function getPriceCache() { return { ..._priceCache }; }
export function clearPriceCache() { Object.keys(_priceCache).forEach(k => delete _priceCache[k]); }

const API = "/api/exec";

// Fallback static data so the dashboard works even without the GScript
const FALLBACK = [
  { Ticker:"LULU","Call/Put":"CALL","Sell Expiry":"5/29/2026","Sell Strike":130,"Buy Expiry":"5/29/2026","Buy Strike":0,Qty:1,"Credit / Debit":3.05,Platform:"RH" },
  { Ticker:"LULU","Call/Put":"CALL","Sell Expiry":"1/15/2027","Sell Strike":0,"Buy Expiry":"1/15/2027","Buy Strike":130,Qty:1,"Credit / Debit":-20.72,Platform:"RH" },
  { Ticker:"MU","Call/Put":"PUT","Sell Expiry":"7/17/2026","Sell Strike":0,"Buy Expiry":"7/17/2026","Buy Strike":800,Qty:1,"Credit / Debit":-138.68,Platform:"RH" },
  { Ticker:"MU","Call/Put":"PUT","Sell Expiry":"7/17/2026","Sell Strike":0,"Buy Expiry":"7/17/2026","Buy Strike":800,Qty:1,"Credit / Debit":-128.08,Platform:"FID" },
  { Ticker:"W","Call/Put":"CALL","Sell Expiry":"12/18/2026","Sell Strike":0,"Buy Expiry":"12/18/2026","Buy Strike":65,Qty:1,"Credit / Debit":-19.10,Platform:"RH" },
  { Ticker:"W","Call/Put":"CALL","Sell Expiry":"1/15/2027","Sell Strike":0,"Buy Expiry":"1/15/2027","Buy Strike":60,Qty:3,"Credit / Debit":-16.14,Platform:"RH" },
  { Ticker:"AAPL","Call/Put":"PUT","Sell Expiry":"12/18/2026","Sell Strike":0,"Buy Expiry":"12/18/2026","Buy Strike":330,Qty:1,"Credit / Debit":-39.00,Platform:"RH" },
  { Ticker:"HD","Call/Put":"CALL","Sell Expiry":"1/15/2027","Sell Strike":0,"Buy Expiry":"1/15/2027","Buy Strike":300,Qty:1,"Credit / Debit":-26.50,Platform:"RH" },
  { Ticker:"HD","Call/Put":"CALL","Sell Expiry":"1/15/2027","Sell Strike":0,"Buy Expiry":"1/15/2027","Buy Strike":300,Qty:2,"Credit / Debit":-38.51,Platform:"FID" },
  { Ticker:"LRCX","Call/Put":"CALL","Sell Expiry":"5/29/2026","Sell Strike":265,"Buy Expiry":"5/29/2026","Buy Strike":0,Qty:2,"Credit / Debit":28.00,Platform:"FID" },
  { Ticker:"SNDK","Call/Put":"CALL","Sell Expiry":"6/5/2026","Sell Strike":1550,"Buy Expiry":"6/5/2026","Buy Strike":0,Qty:1,"Credit / Debit":91.05,Platform:"FID" },
  { Ticker:"SNDK","Call/Put":"CALL","Sell Expiry":"6/12/2026","Sell Strike":1600,"Buy Expiry":"6/12/2026","Buy Strike":0,Qty:1,"Credit / Debit":133.95,Platform:"FID" },
  { Ticker:"CAT","Call/Put":"PUT","Sell Expiry":"9/18/2026","Sell Strike":0,"Buy Expiry":"9/18/2026","Buy Strike":900,Qty:1,"Credit / Debit":-101.94,Platform:"FID" },
  { Ticker:"NVDA","Call/Put":"PUT","Sell Expiry":"9/18/2026","Sell Strike":0,"Buy Expiry":"9/18/2026","Buy Strike":250,Qty:1,"Credit / Debit":-40.00,Platform:"FID" },
  { Ticker:"QQQ","Call/Put":"PUT","Sell Expiry":"12/18/2026","Sell Strike":0,"Buy Expiry":"12/18/2026","Buy Strike":780,Qty:1,"Credit / Debit":-85.00,Platform:"FID" },
  { Ticker:"TGT","Call/Put":"PUT","Sell Expiry":"1/15/2027","Sell Strike":0,"Buy Expiry":"1/15/2027","Buy Strike":150,Qty:1,"Credit / Debit":-35.00,Platform:"FID" },
  { Ticker:"NFLX","Call/Put":"CALL","Sell Expiry":"1/15/2027","Sell Strike":0,"Buy Expiry":"1/15/2027","Buy Strike":80,Qty:2,"Credit / Debit":-16.00,Platform:"FID" },
];

const BASE_PRICES = {
  LRCX:335.49, SNDK:1635.94, LULU:127.79, MU:915.69,
  AAPL:308.33, NVDA:213.95, QQQ:728.04, CAT:906.23,
  TGT:128.39, HD:310.00, W:97.00, NFLX:87.68,
};

export { fetchLivePrices };
export function usePositions() {
  const [groups, setGroups] = useState([]);
  const [balances, setBalances] = useState({ rh: 0, fid: 0 });
  const [watchlist, setWatchlist] = useState([]);
  const [closed, setClosed]       = useState([]);
  const [prices, setPrices] = useState(() => {
    try {
      const saved = localStorage.getItem("g2_prices");
      return saved ? { ...BASE_PRICES, ...JSON.parse(saved) } : { ...BASE_PRICES };
    } catch { return { ...BASE_PRICES }; }
  });
  const [loading, setLoading] = useState(true);
  const [pricesLoading, setPricesLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [pricesUpdated, setPricesUpdated] = useState(null);
  const [usingFallback, setUsingFallback] = useState(false);

  const applyPrices = useCallback((incoming) => {
    setPrices(prev => {
      const next = { ...prev, ...incoming };
      try { localStorage.setItem("g2_prices", JSON.stringify(next)); } catch {}
      return next;
    });
    setPricesUpdated(new Date());
  }, []);

  const refreshPrices = useCallback(async (tickers) => {
    if (!tickers?.length) return;
    setPricesLoading(true);
    const live = await fetchLivePrices(tickers);
    applyPrices(live);
    setPricesLoading(false);
  }, [applyPrices]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    let parsed;
    try {
      const res = await fetch(API);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const rows = json.rows ?? json.data ?? json ?? [];
      const balances = json.balances ?? { rh: 0, fid: 0 };
      setBalances(balances);
      const wl = json.watchlist ?? [];
      setWatchlist(wl);
      const cl = json.closed ?? [];
      setClosed(cl);
      if (!Array.isArray(rows) || rows.length === 0) throw new Error("Empty response");
      parsed = parseRows(rows);
      setGroups(parsed);
      setUsingFallback(false);
    } catch (err) {
      console.warn("GScript fetch failed, using fallback data:", err.message);
      parsed = parseRows(FALLBACK);
      setGroups(parsed);
      setUsingFallback(true);
      setError(err.message);
    } finally {
      setLoading(false);
      setLastUpdated(new Date());
    }
    // Auto-fetch live prices after positions load
    const tickers = parsed.map(g => g.t).slice(0, 8);
    refreshPrices(tickers);
  }, [refreshPrices]);

  useEffect(() => { load(); }, [load]);

  const setPrice = useCallback((ticker, price) => {
    setPrices(prev => {
      const next = { ...prev, [ticker]: price };
      try { localStorage.setItem("g2_prices", JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const getPrice = useCallback((ticker) => {
    return prices[ticker] ?? groups.find(g => g.t === ticker)?.pos?.[0]?.k ?? null;
  }, [prices, groups]);

  return {
    groups, prices, getPrice, setPrice,
    loading, pricesLoading, error,
    lastUpdated, pricesUpdated,
    usingFallback,
    reload: load,
    refreshPrices: (tickerList) =>
      refreshPrices(tickerList ?? groups.map(g => g.t)),
    balances,
    watchlist,
    closed,
  };
}
