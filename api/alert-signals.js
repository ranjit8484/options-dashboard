// Signals alert — runs hourly 9am-4pm ET (14:00-21:00 UTC) Mon-Fri via GitHub Actions
// Checks all tickers for readinessTier === 0 (Trade Now) and sends to signals channel
//
// Required Vercel env vars:
//   TELEGRAM_SIGNALS_TOKEN
//   TELEGRAM_SIGNALS_CHAT_ID
//   VITE_FINNHUB_KEY

import { calcCompositeScore } from '../src/lib/finance.js';

const GSCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxPPb7y-mew7vsXBJ2KmRBQWG57rx8nGgyd7CvqiFXJ5HCbhLidrqcD46pUC4m4XLBRsg/exec';

// Module-level dedup — resets on cold start
const _alerted = new Set();

function getReadinessTier(ticker, sig, spot, allSignals) {
  if (!sig) return 4;

  const cs = calcCompositeScore({
    sig,
    fundamentals: null,
    spot: spot ?? null,
    marketSig: ticker && ticker !== 'QQQ' ? (allSignals?.['QQQ'] ?? null) : null,
  });
  if (!cs) return 4;

  const thesis     = sig?._strategy?.thesis ?? '';
  const conviction = sig?._strategy?.conviction ?? 'none';
  const isConflicted =
    thesis.toLowerCase().includes('conflict') ||
    thesis.toLowerCase().includes('sideways') ||
    thesis.toLowerCase().includes('watch')    ||
    conviction === 'low' || conviction === 'none';

  const rangePos = cs.rangePos ?? null;
  const isBull   = (sig?._entry?.dir ?? '') === 'long';
  const wSince   = sig?.W?.since ?? 0;
  const isCounterTrend =
    cs.tier === 'BLOCK' && rangePos !== null && wSince >= 10 &&
    ((isBull && rangePos > 0.80) || (!isBull && rangePos < 0.20));

  if (isCounterTrend) return 2;

  if (cs.tier !== 'PRIME' && cs.tier !== 'GOOD') {
    if (cs.tier === 'MARGINAL' && !isConflicted) return 3;
    return 4;
  }
  if (isConflicted) return 3;

  const h4          = sig?.['4H'] ?? {};
  const h1          = sig?.['1H'] ?? {};
  const h4xs        = h4.xs ?? 0;
  const h1xs        = h1.xs ?? 0;
  const h4MacdDir   = h4.macdDir ?? '';
  const h4MacdCross = h4.macdCross ?? null;

  const timingOk = isBull ? (h4xs >= 1 || h1xs >= 1) : (h4xs <= -1 || h1xs <= -1);
  const macdOk   = isBull
    ? (h4MacdDir === 'bull' || h4MacdCross === 'bull')
    : (h4MacdDir === 'bear' || h4MacdCross === 'bear');

  return (timingOk && macdOk) ? 0 : 1;
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

async function fetchSignals() {
  const res = await fetch(GSCRIPT_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Vercel)' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`GScript ${res.status}`);
  const json = await res.json();
  return json.signals ?? {};
}

async function fetchPrice(ticker) {
  const key = process.env.VITE_FINNHUB_KEY;
  if (!key) return null;
  try {
    const r = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${key}`
    );
    const j = await r.json();
    return j.c > 0 ? j.c : null;
  } catch {
    return null;
  }
}

async function sendTelegram(message) {
  const token  = process.env.TELEGRAM_SIGNALS_TOKEN;
  const chatId = process.env.TELEGRAM_SIGNALS_CHAT_ID;
  if (!token || !chatId) {
    console.warn('TELEGRAM_SIGNALS_TOKEN / TELEGRAM_SIGNALS_CHAT_ID not set');
    return;
  }
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
  });
}

export default async function handler(req, res) {
  try {
    const signals = await fetchSignals();
    const tickers = Object.keys(signals);

    const lines = [];

    for (const ticker of tickers) {
      const sig = signals[ticker];
      // Fetch price per ticker (rate-limited in breach handler; signals alert fetches sequentially)
      const spot = await fetchPrice(ticker);
      await new Promise(r => setTimeout(r, 250));

      const tier = getReadinessTier(ticker, sig, spot, signals);
      if (tier !== 0) continue;

      const key = `signal:${ticker}`;
      if (_alerted.has(key)) continue;

      const cs     = calcCompositeScore({ sig, fundamentals: null, spot, marketSig: null });
      const isBull = (sig?._entry?.dir ?? '') === 'long';
      const label  = isBull ? 'Sell Put' : 'Sell Call';
      const score  = cs?.score ?? '?';
      const wEmoji = tfEmoji(sig, 'W');
      const dEmoji = tfEmoji(sig, 'D');

      lines.push(`⚡ TRADE NOW: ${ticker} — ${label} · score ${score} · W${wEmoji} D${dEmoji}`);
      _alerted.add(key);
    }

    if (lines.length > 0) {
      await sendTelegram(lines.join('\n'));
    }

    return res.status(200).json({ ok: true, alerts: lines });
  } catch (err) {
    console.error('alert-signals error:', err);
    return res.status(500).json({ error: err.message });
  }
}
