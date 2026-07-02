// Signals alert — runs hourly 9am-4pm ET (14:00-20:00 UTC) Mon-Fri via GitHub Actions
// Computes signals server-side from candle history, then runs tier logic
//
// Required Vercel env vars:
//   TELEGRAM_SIGNALS_TOKEN
//   TELEGRAM_SIGNALS_CHAT_ID
//   VITE_FINNHUB_KEY

import {
  calcComposite, calcEntry, calcStrategy,
  calcCompositeScore,
} from '../src/lib/finance.js';
import {
  getIVFromCandles, getExpiries, buildRec,
} from '../src/lib/strikeCalc.js';

const GSCRIPT_URL  = 'https://script.google.com/macros/s/AKfycbxPPb7y-mew7vsXBJ2KmRBQWG57rx8nGgyd7CvqiFXJ5HCbhLidrqcD46pUC4m4XLBRsg/exec';
const API_BASE     = 'https://options-dashboard-taupe.vercel.app/api/exec';

// ── ET time helpers ───────────────────────────────────────────────
function todayET() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); // YYYY-MM-DD
}

function isMarketHours() {
  const now = new Date();
  // ET is UTC-4 (EDT summer)
  const etOffset = -4 * 60; // minutes
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const etMinutes  = ((utcMinutes + etOffset) % (24 * 60) + 24 * 60) % (24 * 60);
  const day = now.getUTCDay(); // 0=Sun, 6=Sat; adjust to ET day
  const etDayOffset = Math.floor((utcMinutes + etOffset) / (24 * 60));
  const etDay = ((day + etDayOffset) % 7 + 7) % 7;
  if (etDay === 0 || etDay === 6) return false; // weekend
  return etMinutes >= 9 * 60 + 30 && etMinutes < 16 * 60; // 9:30–16:00
}

// ── Module-level dedup (survives warm invocations) ────────────────
// Keyed by ET date → sorted ticker string of last send
const lastSendMap = new Map();

// ── Readiness tier (mirrors SignalsPage.jsx getReadinessTier) ──────
function getReadinessTier(ticker, sig, spot, allSigs, fundamentals, context) {
  if (!sig) return { tier: 4, pendingGates: [], reason: 'No signal' };

  const cs = calcCompositeScore({
    sig,
    fundamentals: fundamentals ?? null,
    spot: spot ?? null,
    marketSig: ticker && ticker !== 'QQQ' ? (allSigs?.['QQQ'] ?? null) : null,
  });
  if (!cs) return { tier: 4, pendingGates: [], reason: 'No score' };

  const conviction  = sig?._strategy?.conviction ?? 'none';
  const thesis      = sig?._strategy?.thesis ?? '';
  const isBull      = (sig?._entry?.dir ?? '') === 'long';
  const wSince      = sig?.W?.since ?? 0;
  const dXs         = sig?.D?.xs ?? 0;
  const wXs         = sig?.W?.xs ?? 0;
  const rangePos    = cs.rangePos ?? null;

  const h4          = sig?.['4H'] ?? {};
  const h1          = sig?.['1H'] ?? {};
  const h4xs        = h4.xs ?? 0;
  const h1xs        = h1.xs ?? 0;
  const h4MacdDir   = h4.macdDir ?? '';
  const h4MacdCross = h4.macdCross ?? null;
  const dMacdDir    = sig?.D?.macdDir ?? '';

  // Hard blocks
  const wAligned = isBull ? wXs >= 1 : wXs <= -1;
  if (!wAligned) return { tier: 4, pendingGates: [], reason: 'No W signal' };
  if (conviction === 'none' || conviction === 'exit')
    return { tier: 4, pendingGates: [], reason: 'No conviction' };

  // Counter-trend
  const isRangeBlock = cs.tier === 'BLOCK' && rangePos !== null
    && ((isBull && rangePos > 0.82) || (!isBull && rangePos < 0.18));
  if (isRangeBlock && wSince >= 10)
    return { tier: 2, pendingGates: [], reason: 'Exhausted — counter-trend probe' };
  if (cs.tier === 'BLOCK')
    return { tier: 4, pendingGates: [], reason: cs.tierLabel ?? 'Blocked' };

  // D alignment
  const dAligned = isBull ? dXs >= 1 : dXs <= -1;

  // Context conflict
  const signalDir         = isBull ? 'bullish' : 'bearish';
  const contextDir        = context?.thesis?.direction ?? null;
  const contextConviction = context?.thesis?.conviction ?? null;
  const isContextConflict = contextDir !== null
    && contextDir !== 'neutral'
    && contextDir !== signalDir;

  const isConflicted = thesis.toLowerCase().includes('conflict')
    || thesis.toLowerCase().includes('sideways')
    || conviction === 'low'
    || isContextConflict;

  // Signal maturity
  const isTooMature    = wSince > 40;
  const isMaturingFast = wSince > 25 && rangePos !== null
    && ((isBull && rangePos > 0.65) || (!isBull && rangePos < 0.35));
  if (isTooMature || isMaturingFast)
    return { tier: 3, pendingGates: [], reason: `Signal mature (${wSince} candles)` };

  // Marginal
  if (!dAligned)
    return { tier: 3, pendingGates: ['D signal not confirmed'], reason: 'W only — wait for D' };
  if (isConflicted && conviction === 'low') {
    const gate = isContextConflict ? 'Context conflict (low conviction)' : 'Context conflict';
    return { tier: 3, pendingGates: [gate], reason: 'Context conflicts with signal' };
  }
  if (cs.tier === 'WEAK' || cs.tier === 'AVOID')
    return { tier: 3, pendingGates: [], reason: 'Score too low' };

  // Entry gates
  const timingOk = isBull ? (h4xs >= 1 || h1xs >= 1) : (h4xs <= -1 || h1xs <= -1);
  const macdOk   = isBull
    ? (h4MacdDir === 'bull' || h4MacdCross === 'bull' || dMacdDir === 'bull')
    : (h4MacdDir === 'bear' || h4MacdCross === 'bear' || dMacdDir === 'bear');

  if (isConflicted) {
    const conflictLabel = isContextConflict && contextConviction === 'low'
      ? 'Context conflict (low conviction)' : 'Context conflict — review thesis';
    const pending = [conflictLabel];
    if (!timingOk) pending.push('4H/1H timing');
    if (!macdOk)   pending.push('MACD alignment');
    return { tier: 1, pendingGates: pending, reason: 'Context conflict — watch only' };
  }

  const isExtended = rangePos !== null
    && ((isBull && rangePos > 0.65) || (!isBull && rangePos < 0.35));
  if (isExtended && cs.tier !== 'PRIME') {
    const pending = ['Range extended — wait for pullback'];
    if (!timingOk) pending.push('4H/1H timing');
    return { tier: 1, pendingGates: pending, reason: 'Extended range — reduce size' };
  }

  const pendingGates = [];
  if (!timingOk) pendingGates.push('4H/1H timing');
  if (!macdOk)   pendingGates.push('MACD alignment');

  if (pendingGates.length === 0)
    return { tier: 0, pendingGates: [], reason: 'All gates clear' };
  if (pendingGates.length === 1)
    return { tier: 1, pendingGates, reason: `Waiting: ${pendingGates[0]}` };
  if (cs.tier === 'PRIME' || cs.score >= 70)
    return { tier: 1, pendingGates, reason: 'Strong setup — waiting for timing' };

  return { tier: 3, pendingGates, reason: 'Gates not ready' };
}

function tfEmoji(sig, tf) {
  const s = sig?.[tf];
  if (!s) return '';
  if ((s.xs ?? 0) >= 2) return '🚀';
  if ((s.xs ?? 0) >= 1) return '✅';
  if ((s.xs ?? 0) <= -2) return '🔻';
  if ((s.xs ?? 0) <= -1) return '⬇️';
  return '➡️';
}

// Compute full signal object from multi-timeframe candle history
function computeSig(history) {
  if (!history) return null;
  const TFS = [
    { key: 'W',  field: '1wk' },
    { key: 'D',  field: '1d'  },
    { key: '4H', field: '4h'  },
    { key: '1H', field: '1h'  },
  ];
  const computed = {};
  for (const tf of TFS) {
    const raw = history[tf.field] ?? history[tf.key] ?? [];
    if (!Array.isArray(raw) || raw.length < 55) continue;
    // Candle format: [timestamp, high, low, close]
    const candles = raw.map(c => ({ h: c[1], l: c[2], c: c[3] }));
    const result  = calcComposite(candles);
    if (result) computed[tf.key] = result;
  }
  if (!computed.W && !computed.D) return null;
  computed._entry    = calcEntry(computed);
  computed._strategy = calcStrategy(computed._entry, computed);
  return computed;
}

async function fetchWatchlist() {
  const res = await fetch(`${GSCRIPT_URL}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Vercel)' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`GScript ${res.status}`);
  const json = await res.json();
  // Get tickers from watchlist + active positions
  const wl  = (json.watchlist ?? []).map(w => w.ticker ?? w).filter(Boolean);
  const pos = (json.rows ?? json.data ?? []).map(r => r.Ticker ?? r.ticker).filter(Boolean);
  return [...new Set([...wl, ...pos])];
}

async function fetchHistory(tickers) {
  try {
    const r = await fetch(`${API_BASE}?action=history&tickers=${tickers.join(',')}`);
    if (!r.ok) return {};
    const data = await r.json();
    return data.history ?? data ?? {};
  } catch { return {}; }
}

async function fetchBulk(action, tickers) {
  try {
    const r = await fetch(`${API_BASE}?action=${action}&tickers=${tickers.join(',')}`);
    if (!r.ok) return {};
    const data = await r.json();
    const map = data[action] ?? data;
    return (typeof map === 'object' && !Array.isArray(map)) ? map : {};
  } catch { return {}; }
}

async function fetchPrice(ticker) {
  const key = process.env.VITE_FINNHUB_KEY;
  if (!key) return null;
  try {
    const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${key}`);
    const j = await r.json();
    return j.c > 0 ? j.c : null;
  } catch { return null; }
}

async function sendTelegram(message) {
  const token  = process.env.TELEGRAM_SIGNALS_TOKEN;
  const chatIds = (process.env.TELEGRAM_SIGNALS_CHAT_ID ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (!token || !chatIds.length) {
    console.warn('TELEGRAM_SIGNALS_TOKEN / TELEGRAM_SIGNALS_CHAT_ID not set');
    return;
  }
  await Promise.all(chatIds.map(chatId =>
    fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
    })
  ));
}

export default async function handler(req, res) {
  try {
    // Market hours guard: Mon-Fri 9:30am-4:00pm ET only
    if (!isMarketHours()) {
      return res.status(200).json({ ok: true, skipped: 'outside market hours' });
    }

    // 1. Get ticker list from GScript
    const tickers = await fetchWatchlist();
    if (!tickers.length) {
      return res.status(200).json({ ok: true, alerts: [], note: 'No tickers' });
    }

    // 2. Fetch candle history, fundamentals, context in parallel
    const [history, fundamentalsMap, contextMap] = await Promise.all([
      fetchHistory(tickers),
      fetchBulk('fundamentals', tickers),
      fetchBulk('context',      tickers),
    ]);

    // 3. Compute signals for all tickers
    const allSigs = {};
    for (const ticker of tickers) {
      const sig = computeSig(history[ticker]);
      if (sig) allSigs[ticker] = sig;
    }

    // Candidate buckets — collect all, sort by score descending
    const tradeNowCandidates = []; // { ticker, score, block }
    const watchCandidates    = []; // { ticker, score, line }

    // 4. Fetch prices sequentially and evaluate each ticker
    for (const ticker of tickers) {
      const sig = allSigs[ticker];
      if (!sig) continue;

      const spot = await fetchPrice(ticker);
      await new Promise(r => setTimeout(r, 250));

      const result = getReadinessTier(
        ticker, sig, spot, allSigs,
        fundamentalsMap[ticker] ?? null,
        contextMap[ticker]      ?? null
      );

      const cs       = calcCompositeScore({ sig, fundamentals: fundamentalsMap[ticker] ?? null, spot, marketSig: null });
      const scoreNum = cs?.score ?? 0;
      const rangePos = cs?.rangePos ?? null;
      const rangePct = rangePos !== null ? Math.round(rangePos * 100) : null;

      if (result.tier === 0) {
        const isBull = (sig._entry?.dir ?? '') === 'long';
        const isCall = !isBull;
        const label  = isBull ? 'Sell Put' : 'Sell Call';

        // IV from daily candles
        const dCandles = (history[ticker]?.['1d'] ?? history[ticker]?.D ?? [])
          .map(c => ({ h: c[1], l: c[2], c: c[3] }));
        const iv = dCandles.length >= 31 ? getIVFromCandles(ticker, dCandles) : null;

        // Strike recommendation
        const expiries = getExpiries(2, 20);
        const expiry   = expiries[0] ?? { dte: 30, label: '?' };
        const tooCheapForSpread = spot && spot < 10;
        const rec = (spot && !tooCheapForSpread) ? buildRec({
          spot, ticker, isCall,
          shortDelta: 0.30, longDelta: 0.15,
          dte: expiry.dte, tradeType: 'spread',
          account: 100000, conviction: 'medium',
          params: null, ivOverride: iv,
        }) : null;

        const bufferNum = rec?.buffer != null ? parseFloat(rec.buffer) : null;

        // Context note
        let contextNote;
        if (scoreNum >= 70 && rangePct !== null && rangePct >= 15 && rangePct <= 60) {
          contextNote = '✅ Best setup';
        } else if (bufferNum !== null && bufferNum < 6) {
          contextNote = '⚠️ Buffer tight — consider skipping';
        } else if (rangePct !== null && rangePct > 70) {
          contextNote = '⚠️ Extended — counter-trend only';
        } else if (bufferNum !== null && bufferNum >= 25) {
          contextNote = '✅ Wide buffer — clean entry';
        } else {
          contextNote = '✅ Valid setup';
        }

        // Line 1: ticker · direction · score
        const l1 = `${ticker} · ${label} · score ${scoreNum || '?'}`;

        // Line 2: price · W · D · range% · IV%
        const spotStr  = spot ? `$${spot.toFixed(2)}` : '—';
        const rangeStr = rangePct !== null ? `range ${rangePct}%` : '';
        const ivStr    = iv ? `IV ${Math.round(iv * 100)}%` : '';
        const l2parts  = [spotStr, `W${tfEmoji(sig, 'W')}`, `D${tfEmoji(sig, 'D')}`, rangeStr, ivStr].filter(Boolean);
        const l2 = l2parts.join(' · ');

        // Line 3: strike rec
        let l3;
        if (tooCheapForSpread) {
          l3 = `→ Naked put only — stock too cheap for spread`;
        } else if (!rec) {
          l3 = `→ Spread not viable — premium too low · consider naked`;
        } else {
          const prem = rec.premium != null && !isNaN(rec.premium) ? `$${rec.premium}cr` : '—';
          const strikeDesc = rec.longStrike
            ? `${isCall ? 'Buy' : 'Sell'} $${rec.shortStrike}${isCall ? 'c' : 'p'} / ${isCall ? 'Sell' : 'Buy'} $${rec.longStrike}${isCall ? 'c' : 'p'}`
            : `${label} $${rec.shortStrike}${isCall ? 'c' : 'p'}`;
          l3 = `→ ${strikeDesc} · ${expiry.label} · ${prem} · max loss $${rec.maxLoss ?? '—'}`;
        }

        // Line 4: buffer · context note
        const bufferStr = bufferNum !== null ? `Buffer ${rec.buffer}%` : '';
        const l4 = [bufferStr, contextNote].filter(Boolean).join(' · ');

        const block = [l1, l2, l3, l4].filter(Boolean).join('\n');
        tradeNowCandidates.push({ ticker, score: scoreNum, block });

      } else if (result.tier === 1) {
        const spotStr = spot ? `$${spot.toFixed(2)}` : '';
        const gates   = result.pendingGates.length > 0
          ? result.pendingGates.join(', ')
          : result.reason;

        watchCandidates.push({
          ticker,
          score: scoreNum,
          line: `👀 ${ticker} ${spotStr} · score ${scoreNum || '?'} · waiting: ${gates}`,
        });
      }
    }

    // Sort by score descending (show all — no cap)
    tradeNowCandidates.sort((a, b) => b.score - a.score);
    watchCandidates.sort((a, b) => b.score - a.score);

    // Module-level dedup: skip if same Trade Now ticker set already sent today
    const today = todayET();
    const tickerKey = tradeNowCandidates.map(c => c.ticker).sort().join(',');
    if (tickerKey && lastSendMap.get(today) === tickerKey) {
      return res.status(200).json({ ok: true, skipped: 'same signals already sent today' });
    }
    if (tickerKey) lastSendMap.set(today, tickerKey);
    // Clean up old dates from the map
    for (const k of lastSendMap.keys()) { if (k !== today) lastSendMap.delete(k); }

    // Build message
    const now = new Date();
    const headerTime = now.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
      hour12: true,
    });
    const header = `⚡ G2 Signals — ${headerTime} ET`;
    const divider = '━━━━━━━━━━━━━━━━━━━';

    const sections = [header];

    if (tradeNowCandidates.length > 0) {
      sections.push(divider);
      const numbered = tradeNowCandidates.map((c, i) => `${i + 1}. ${c.block}`);
      sections.push(numbered.join('\n\n'));
    }

    if (watchCandidates.length > 0) {
      sections.push(divider);
      sections.push(watchCandidates.map(c => c.line).join('\n'));
    }

    if (tradeNowCandidates.length > 0 || watchCandidates.length > 0) {
      await sendTelegram(sections.join('\n'));
    }

    const alerts = [
      ...tradeNowCandidates.map(c => c.block),
      ...watchCandidates.map(c => c.line),
    ];
    return res.status(200).json({
      ok: true, alerts,
      tickers: tickers.length,
      signals: Object.keys(allSigs).length,
      tradeNow: tradeNowCandidates.length,
      watch: watchCandidates.length,
    });
  } catch (err) {
    console.error('alert-signals error:', err);
    return res.status(500).json({ error: err.message });
  }
}
