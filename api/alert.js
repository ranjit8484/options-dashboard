import { calcCompositeScore, parseRows } from '../src/lib/finance.js';

const GSCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxPPb7y-mew7vsXBJ2KmRBQWG57rx8nGgyd7CvqiFXJ5HCbhLidrqcD46pUC4m4XLBRsg/exec';

// Module-level dedup — resets on cold start
const _alerted = new Set();

function getReadinessTier(row, spot, signals) {
  const { sig, t: ticker } = row;
  if (!sig) return 4;

  const cs = calcCompositeScore({
    sig,
    fundamentals: null,
    spot: spot ?? null,
    marketSig: ticker && ticker !== 'QQQ' ? (signals?.['QQQ'] ?? null) : null,
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

  const h4         = sig?.['4H'] ?? {};
  const h1         = sig?.['1H'] ?? {};
  const h4xs       = h4.xs ?? 0;
  const h1xs       = h1.xs ?? 0;
  const h4MacdDir  = h4.macdDir ?? '';
  const h4MacdCross = h4.macdCross ?? null;

  const timingOk = isBull ? (h4xs >= 1 || h1xs >= 1) : (h4xs <= -1 || h1xs <= -1);
  const macdOk   = isBull
    ? (h4MacdDir === 'bull' || h4MacdCross === 'bull')
    : (h4MacdDir === 'bear' || h4MacdCross === 'bear');

  return (timingOk && macdOk) ? 0 : 1;
}

async function fetchPositions() {
  const res = await fetch(GSCRIPT_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Vercel)' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`GScript ${res.status}`);
  const json = await res.json();
  const rows = json.rows ?? json.data ?? json ?? [];
  return { groups: parseRows(Array.isArray(rows) ? rows : []), signals: json.signals ?? {} };
}

async function fetchPrices(tickers) {
  const key = process.env.VITE_FINNHUB_KEY;
  if (!key) return {};
  const results = {};
  for (const ticker of tickers) {
    try {
      const r = await fetch(
        `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${key}`
      );
      const j = await r.json();
      if (j.c > 0) results[ticker] = j.c;
    } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  return results;
}

async function sendTelegram(message) {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn('Telegram env vars not set — skipping send');
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
    const { groups, signals } = await fetchPositions();
    const tickers = groups.map(g => g.t);
    const prices  = await fetchPrices(tickers);

    const lines = [];

    for (const group of groups) {
      const ticker = group.t;
      const spot   = prices[ticker] ?? null;
      const sig    = signals[ticker] ?? null;

      // TRADE NOW check
      if (sig) {
        const row = { sig, t: ticker };
        const tier = getReadinessTier(row, spot, signals);
        const cs   = calcCompositeScore({ sig, fundamentals: null, spot, marketSig: null });
        if (tier === 0 && cs?.tier === 'PRIME') {
          const key = `trade:${ticker}`;
          if (!_alerted.has(key)) {
            const label = sig?._entry?.dir === 'long' ? 'Sell Put' : 'Sell Call';
            lines.push(`⚡ TRADE NOW: ${ticker} — ${label} · score ${cs.score}`);
            _alerted.add(key);
          }
        }
      }

      // STRIKE BREACH check
      if (spot) {
        for (const pos of group.pos ?? []) {
          if (pos.dir !== 'sc' && pos.dir !== 'sp') continue;
          const strike = pos.k;
          if (!strike) continue;
          const breached = pos.dir === 'sc' ? spot >= strike : spot <= strike;
          if (breached) {
            const key = `breach:${ticker}:${strike}:${pos.dir}`;
            if (!_alerted.has(key)) {
              const type  = pos.dir === 'sc' ? `${strike}c` : `${strike}p`;
              lines.push(`🚨 BREACH: ${ticker} $${spot} — ${type} breached (price $${spot})`);
              _alerted.add(key);
            }
          }
        }
      }
    }

    if (lines.length > 0) {
      await sendTelegram(lines.join('\n'));
    }

    return res.status(200).json({ ok: true, alerts: lines });
  } catch (err) {
    console.error('alert handler error:', err);
    return res.status(500).json({ error: err.message });
  }
}
