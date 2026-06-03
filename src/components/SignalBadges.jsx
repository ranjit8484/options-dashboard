import { useState } from "react";
import { createPortal } from "react-dom";
import { TIMEFRAMES } from "../hooks/useSignals";
import styles from "./SignalBadges.module.css";

// ── Ichimoku helpers ──────────────────────────────────────────────
function ichSymbol(sig) {
  if (!sig) return "·";
  const inCloud = sig.priceVsCloud === 'in';
  if (sig.xs ===  2) return "🚀";
  if (sig.xs ===  1) return inCloud ? "△" : "▲";
  if (sig.xs === -1) return inCloud ? "▽" : "▼";
  if (sig.xs === -2) return "☄️";
  return "·";
}

function ichVariant(sig) {
  if (!sig) return "none";
  if (sig.xs ===  2) return "strongBuy";
  if (sig.xs ===  1) return "buy";
  if (sig.xs === -1) return "sell";
  if (sig.xs === -2) return "strongSell";
  return "none";
}

function ichLabel(xs) {
  return { 2: "🚀 Strong Bull", 1: "▲ Bull", "-1": "▼ Bear", "-2": "☄️ Strong Bear" }[xs] ?? "· Neutral";
}

function rsiZone(rsi) {
  if (rsi > 83)    return "extreme — exit zone";
  if (rsi > 76)    return "very overbought";
  if (rsi >= 63)   return "sell zone (63-76) ✓";
  if (rsi >= 55)   return "bullish momentum";
  if (rsi >= 45)   return "neutral";
  if (rsi >= 35)   return "bearish momentum";
  if (rsi >= 24)   return "sell zone (24-37) ✓";
  if (rsi >= 17)   return "very oversold";
  return "extreme — exit zone";
}

// ── Explanation builder ───────────────────────────────────────────
function buildExplanation(entry, strategy, sigs) {
  const W = sigs?.W, D = sigs?.D, h4 = sigs?.['4H'], h1 = sigs?.['1H'];
  if (!D || !entry) return null;

  const key = entry.dir ? `${entry.action}-${entry.dir}` : entry.action;
  const rows = [];

  // ── Trend layer ──
  rows.push({ type: 'section', text: 'Trend' });
  rows.push({
    type: 'check',
    ok:   D.xs >= 1,
    fail: D.xs <= -1,
    label: 'Daily (primary)',
    detail: `${ichLabel(D.xs)} · RSI ${D.rsi} · price ${D.priceVsCloud} cloud`,
  });
  if (W) {
    const blocks   = W.xs === -2;
    const confirms = W.xs >= 1;
    rows.push({
      type:  'check',
      ok:    confirms,
      warn:  !blocks && !confirms,
      fail:  blocks,
      label: 'Weekly (context)',
      detail: `${ichLabel(W.xs)} · RSI ${W.rsi}${blocks ? ' · ⚠ BLOCKING — bearish W vs bullish D' : confirms ? ' · confirms direction' : ' · neutral, not blocking'}`,
    });
  }

  // ── Timing layer ──
  rows.push({ type: 'section', text: 'Timing (4H)' });
  if (h4) {
    const inSell  = h4.rsi >= 63 && h4.rsi <= 76;
    const inEntry = h4.rsi >= 35 && h4.rsi <= 65;
    rows.push({
      type:  'check',
      ok:    inSell || inEntry,
      warn:  !inSell && !inEntry && h4.rsi > 65 && h4.rsi <= 76,
      fail:  !inSell && !inEntry,
      label: '4H RSI',
      detail: `${h4.rsi} — ${rsiZone(h4.rsi)}`,
    });
    rows.push({
      type:  'check',
      ok:    !!h4.macdCross,
      warn:  !h4.macdCross && h4.macdDir === 'bull',
      fail:  !h4.macdCross && h4.macdDir === 'bear',
      label: '4H MACD',
      detail: `${h4.macdDir === 'bull' ? 'Bullish' : 'Bearish'}${h4.macdCross ? ` · fresh ${h4.macdCross} cross ←` : ' · trending, no fresh cross'}`,
    });
    if (h1) {
      rows.push({
        type:  'check',
        ok:    !!h1.macdCross,
        warn:  !h1.macdCross,
        fail:  false,
        label: '1H MACD',
        detail: `${h1.macdDir === 'bull' ? 'Bullish' : 'Bearish'}${h1.macdCross ? ` · ${h1.macdCross} cross ←` : ' · no fresh cross'}`,
      });
    }
  }

  // ── Why this signal ──
  rows.push({ type: 'section', text: 'Why this signal' });
  const reasons = {
    'ENTER-long':  'D bullish + W not blocking + 4H MACD bull cross in entry zone. All conditions met.',
    'ENTER-short': 'D bearish + W not blocking + 4H MACD bear cross in entry zone. All conditions met.',
    'SELL-put':    'D is bullish — trend is your protection. 4H RSI in sell zone (63-76) with no reversal cross. Elevated premium makes this a good time to sell an OTM put. The bull trend keeps the put worthless.',
    'SELL-call':   'D is bearish — trend is your protection. 4H RSI in sell zone (24-37) with no reversal cross. Elevated premium makes this a good time to sell an OTM call. The bear trend keeps the call worthless.',
    'WATCH-long':  'D is bullish but 4H entry hasn\'t triggered yet — no MACD bull cross or RSI is outside the 35-65 entry window.',
    'WATCH-short': 'D is bearish but 4H entry hasn\'t triggered yet — no MACD bear cross or RSI is outside the 35-65 entry window.',
    'WAIT-long':   'D is bullish but W=☄️ is directly opposing. Trading a bullish D against a bearish W is high risk.',
    'WAIT-short':  'D is bearish but W=🚀 is directly opposing. Trading a bearish D against a bullish W is high risk.',
    'WAIT':        'D and W have no clear directional agreement. No trade until alignment.',
    'EXIT':        '4H RSI hit extreme levels with momentum turning. Risk/reward no longer favourable — consider closing.',
  };
  rows.push({ type: 'reason', text: reasons[key] ?? 'Signal conditions evaluated against the framework.' });

  // ── What would change this ──
  const upgrades = {
    'WATCH-long':  'Upgrades to ENTER LONG when: 4H MACD bull cross fires + RSI pulls back to 35-65.',
    'WATCH-long2': 'Upgrades to SELL PUT when: 4H RSI rises into 63-76 without a bear cross.',
    'WATCH-short': 'Upgrades to ENTER SHORT when: 4H MACD bear cross fires + RSI 35-65.',
    'WAIT-long':   'Upgrades when: Weekly closes above Ichimoku cloud (W signal improves to ▲ or 🚀).',
    'WAIT-short':  'Upgrades when: Weekly closes below Ichimoku cloud.',
    'WAIT':        'Upgrades when: D and W align on the same direction.',
    'SELL-put':    'Exit trigger: 4H MACD bear cross OR 4H RSI exceeds 76.',
    'SELL-call':   'Exit trigger: 4H MACD bull cross OR 4H RSI drops below 24.',
    'ENTER-long':  'Exit trigger: 4H RSI > 76 + MACD bear cross, or RSI > 83.',
    'ENTER-short': 'Exit trigger: 4H RSI < 24 + MACD bull cross, or RSI < 17.',
  };
  const upgradeText = upgrades[key];
  if (upgradeText) {
    rows.push({ type: 'section', text: 'Watch for' });
    rows.push({ type: 'upgrade', text: upgradeText });
    if (key === 'WATCH-long' && upgrades['WATCH-long2']) {
      rows.push({ type: 'upgrade', text: upgrades['WATCH-long2'] });
    }
  }

  return rows;
}

// ── Modal ─────────────────────────────────────────────────────────
function SignalModal({ ticker, entry, strategy, sigs, onClose }) {
  const rows = buildExplanation(entry, strategy, sigs);
  if (!rows) return null;

  const thesis = strategy?.thesis ?? entry.action;
  const trade  = strategy?.label;

  return createPortal(
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>

        <div className={styles.modalHeader}>
          <div>
            <span className={styles.modalTicker}>{ticker}</span>
            <span className={styles.modalDash}> — </span>
            <span className={styles.modalTitle}>{thesis}</span>
            {trade && trade !== thesis && (
              <span className={styles.modalTrade}> · {trade}</span>
            )}
          </div>
          <button className={styles.modalClose} onClick={onClose}>✕</button>
        </div>

        <div className={styles.modalBody}>
          {rows.map((row, i) => {
            if (row.type === 'section')
              return <div key={i} className={styles.modalSection}>{row.text}</div>;

            if (row.type === 'check')
              return (
                <div key={i} className={`${styles.checkRow} ${row.ok ? styles.checkOk : row.warn ? styles.checkWarn : styles.checkFail}`}>
                  <span className={styles.checkIcon}>{row.ok ? '✓' : row.warn ? '~' : '✗'}</span>
                  <span className={styles.checkLabel}>{row.label}</span>
                  <span className={styles.checkDetail}>{row.detail}</span>
                </div>
              );

            if (row.type === 'reason')
              return <div key={i} className={styles.modalReason}>{row.text}</div>;

            if (row.type === 'upgrade')
              return <div key={i} className={styles.modalUpgrade}>{row.text}</div>;

            return null;
          })}
        </div>

      </div>
    </div>,
    document.body
  );
}

// ── Entry badge (shows thesis) ────────────────────────────────────
function EntryBadge({ entry, thesis, onClick }) {
  if (!entry) return null;

  // Color class driven by action type, text driven by thesis
  const clsMap = {
    'EXIT':        styles.entryExit,
    'ENTER-long':  styles.entryLong,
    'ENTER-short': styles.entryShort,
    'SELL-put':    styles.entrySell,
    'SELL-call':   styles.entrySell,
    'WATCH-long':  styles.entryWatch,
    'WATCH-short': styles.entryWatch,
    'WAIT-long':   styles.entryWait,
    'WAIT-short':  styles.entryWait,
    'WAIT':        styles.entryWait,
  };
  const key = entry.dir ? `${entry.action}-${entry.dir}` : entry.action;
  const cls = clsMap[key] ?? styles.entryWait;

  return (
    <div className={`${styles.entry} ${cls} ${styles.clickable}`} onClick={onClick} title="Click for explanation">
      {thesis ?? key}
    </div>
  );
}

// ── Strategy badge ────────────────────────────────────────────────
function StrategyBadge({ strategy }) {
  if (!strategy) return null;
  return (
    <div className={`${styles.strategy} ${styles[strategy.variant]}`}>
      {strategy.label}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────
export function SignalBadges({ ticker, tickerSignals, loading }) {
  const [modalOpen, setModalOpen] = useState(false);

  if (loading && !tickerSignals)
    return <div className={styles.wrapper}><span className={styles.loadingText}>loading signals…</span></div>;
  if (!tickerSignals) return null;

  return (
    <div className={styles.wrapper}>
      <EntryBadge
        entry={tickerSignals._entry}
        thesis={tickerSignals._strategy?.thesis}
        onClick={() => setModalOpen(true)}
      />
      <StrategyBadge strategy={tickerSignals._strategy} />
      <div className={styles.divider} />
      <div className={styles.row}>
        {TIMEFRAMES.map(tf => {
          const sig = tickerSignals[tf.key];
          return (
            <div key={tf.key} className={`${styles.chip} ${styles[ichVariant(sig)]}`}>
              <span className={styles.tf}>{tf.label}</span>
              <span className={styles.symbol}>{ichSymbol(sig)}</span>
              {sig && (sig.since ?? 1) > 1 && (
                <span className={styles.since}>
                  {sig.since >= 100 ? '100+' : sig.since}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {modalOpen && (
        <SignalModal
          ticker={ticker}
          entry={tickerSignals._entry}
          strategy={tickerSignals._strategy}
          sigs={tickerSignals}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  );
}
