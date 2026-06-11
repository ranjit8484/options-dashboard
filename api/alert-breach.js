// Breach alert — runs daily at 8:30am ET (13:30 UTC) via GitHub Actions
// Checks short position breaches and LEAP at-risk positions
// Uses TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (private bot)
//
// Required Vercel env vars:
//   TELEGRAM_BOT_TOKEN
//   TELEGRAM_CHAT_ID
//   VITE_FINNHUB_KEY

import { parseRows } from '../src/lib/finance.js';

const GSCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxPPb7y-mew7vsXBJ2KmRBQWG57rx8nGgyd7CvqiFXJ5HCbhLidrqcD46pUC4m4XLBRsg/exec';

// Module-level dedup — resets on cold start
const _alerted = new Set();

async function fetchPositions() {
  const res = await fetch(GSCRIPT_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Vercel)' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`GScript ${res.status}`);
  const json = await res.json();
  const rows = json.rows ?? json.data ?? json ?? [];
  return parseRows(Array.isArray(rows) ? rows : []);
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
    console.warn('TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set');
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
    const groups = await fetchPositions();
    const prices = await fetchPrices(groups.map(g => g.t));

    const lines = [];

    for (const group of groups) {
      const ticker = group.t;
      const spot   = prices[ticker] ?? null;
      if (!spot) continue;

      for (const pos of group.pos ?? []) {
        const strike = pos.k;
        if (!strike) continue;
        const plat = pos.plat ? ` [${pos.plat}]` : '';

        // Short breaches: sc (call) or sp (put), excluding misclassified LEAPs
        if (pos.dir === 'sc' || pos.dir === 'sp') {
          const tt = (pos.tradeType ?? pos.lbl ?? '').toLowerCase();
          if (tt.includes('leap')) continue;
          const breached = pos.dir === 'sc' ? spot >= strike : spot <= strike;
          if (breached) {
            const key = `breach:${ticker}:${strike}:${pos.dir}`;
            if (!_alerted.has(key)) {
              const type = pos.dir === 'sc' ? `${strike}c` : `${strike}p`;
              lines.push(`🚨 BREACH${plat}: ${ticker} — ${type} breached · price $${spot}`);
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
    console.error('alert-breach error:', err);
    return res.status(500).json({ error: err.message });
  }
}
