import { useRef, useState } from "react";
import { Badge, PlatBadge, StatusBadge } from "./Badge";
import { calcCollateral, calcStatus, estPnl, hvFromCandles, f$, fi$, fk$, IV } from "../lib/finance";
import styles from "./TickerCard.module.css";

function calcExit(dir, status, dte, diff, prem, price, k, isSpread, spreadWidth, longK) {
  const isShort = dir === 'sc' || dir === 'sp';
  const isLong  = dir === 'lc' || dir === 'lp';
  const dteVal  = dte ?? 999;
  const isCall  = dir === 'sc' || dir === 'lc';

  // ── Spread exit logic ─────────────────────────────
  if (isSpread && isShort && spreadWidth > 0) {
    const maxLoss        = (spreadWidth - prem) * 100;
    const bufferToStrike = Math.abs(price - k);
    const bufferPct      = (bufferToStrike / price * 100).toFixed(1);
    const halfProfit     = prem * 0.5;
    const atRisk         = diff > 0;

    if (atRisk && dteVal <= 5)
      return {
        urgency: 'danger',
        text:    `Short strike breached — ${dteVal}d left · close immediately`,
        action:  'Close',
        detail:  `Max loss $${Math.round(maxLoss).toLocaleString()} if held to expiry`,
        rule:    'breach+expiry'
      };
    if (atRisk)
      return {
        urgency: 'danger',
        text:    `Above short strike $${k} · spread in danger`,
        action:  'Close or roll',
        detail:  isCall
          ? `Roll short call up and out if ${dteVal}+ DTE · close if < 5 DTE`
          : `Roll short put down and out if ${dteVal}+ DTE · close if < 5 DTE`,
        rule: 'breach'
      };
    if (bufferToStrike < spreadWidth * 0.3)
      return {
        urgency: 'watch',
        text:    `Only $${Math.round(bufferToStrike)} from short strike · ${bufferPct}% buffer`,
        action:  'Watch closely',
        detail:  `Close if daily close above $${k} · target: 50% profit ($${Math.round(halfProfit * 100).toLocaleString()})`,
        rule:    'close_watch'
      };
    if (dteVal <= 7)
      return {
        urgency: 'watch',
        text:    `${dteVal}d remaining · target close window`,
        action:  'Review today',
        detail:  `Close if $${k} threatened · let expire if ${bufferPct}% buffer holds`,
        rule:    'gamma'
      };
    const profitPct = prem > 0
      ? Math.round((1 - (Math.max(0, diff) / prem)) * 100)
      : 0;
    if (profitPct >= 50)
      return {
        urgency: 'safe',
        text:    `${profitPct}% profit achieved · ${bufferPct}% buffer to strike`,
        action:  'Close for profit',
        detail:  `At 50%+ target — close now or set limit order at $${(prem * 0.5).toFixed(2)}`,
        rule:    'profit_target'
      };
    return {
      urgency: 'safe',
      text:    `$${Math.round(bufferToStrike)} buffer to $${k} strike · ${dteVal}d left`,
      action:  'Hold',
      detail:  `Close at 50% profit ($${Math.round(halfProfit * 100).toLocaleString()}) · close if daily close above $${k}`,
      rule:    'hold'
    };
  }

  // ── Naked short exit logic ────────────────────────
  if (isShort) {
    if (status === 'danger') {
      if (dteVal <= 7)
        return {
          urgency: 'danger',
          text:    'Roll immediately — ITM at expiry',
          action:  'Roll now',
          detail:  'Roll out 2-4 weeks to higher/lower strike',
          rule:    'roll_urgent'
        };
      return {
        urgency: 'danger',
        text:    'Roll up/out — consider 2-4 week extension',
        action:  'Roll',
        detail:  'Do not wait — move strike further OTM',
        rule:    'roll'
      };
    }
    if (status === 'watch') {
      if (dteVal <= 5)
        return {
          urgency: 'watch',
          text:    'Decide now: roll or let expire',
          action:  'Decide',
          detail:  'Close if approaching strike · let expire if safely OTM',
          rule:    'decide'
        };
      return {
        urgency: 'watch',
        text:    'Monitor daily — roll if breaches strike',
        action:  'Watch',
        detail:  'Set price alert at strike level',
        rule:    'monitor'
      };
    }
    const profitPct = prem > 0
      ? Math.round(((prem - Math.max(0, Math.abs(diff))) / prem) * 100)
      : 0;
    if (dteVal <= 7)
      return {
        urgency: 'watch',
        text:    `${dteVal}d remaining — consider closing`,
        action:  'Review today',
        detail:  'At 7 DTE theta accelerates — close or let expire based on buffer',
        rule:    'seven_dte'
      };
    if (profitPct >= 50)
      return {
        urgency: 'safe',
        text:    `Close at ${profitPct}% profit or hold to expiry`,
        action:  'Close for profit',
        detail:  '50%+ target achieved — close now',
        rule:    'profit_target'
      };
    return {
      urgency: 'safe',
      text:    'Hold to 50% profit target or expiry',
      action:  'Hold',
      detail:  `${profitPct}% achieved — target: 50%`,
      rule:    'hold'
    };
  }

  // ── Long position exit logic ──────────────────────
  if (isLong) {
    if (dteVal < 60 && dteVal > 0)
      return {
        urgency: 'watch',
        text:    `Roll forward — only ${dteVal}d left`,
        action:  'Roll forward',
        detail:  'Losing time value fast — roll to later expiry',
        rule:    'roll_forward'
      };
    if (status === 'safe') {
      const pctItm = k > 0 ? Math.round(Math.abs(diff) / k * 100) : 0;
      if (pctItm >= 15)
        return {
          urgency: 'safe',
          text:    `Deep ITM (${pctItm}%) — consider taking profit`,
          action:  'Take profit or roll',
          detail:  'Roll strike closer to current price to lock in gains',
          rule:    'deep_itm'
        };
      return {
        urgency: 'safe',
        text:    'Hold — sell short-term premium against this',
        action:  'Sell hedge',
        detail:  'Sell 2-4 week call/put to offset cost',
        rule:    'sell_hedge'
      };
    }
    return {
      urgency: 'watch',
      text:    'Hold — wait for move in your direction',
      action:  'Hold',
      detail:  `${dteVal}d remaining — theta working against you`,
      rule:    'hold'
    };
  }

  return null;
}

const BASE_CFG = {
  LRCX:{min:200,max:500,step:.5}, SNDK:{min:1200,max:2200,step:5},
  LULU:{min:80,max:220,step:.5},  MU:{min:650,max:1200,step:1},
  AAPL:{min:200,max:450,step:.5}, NVDA:{min:120,max:350,step:.5},
  QQQ:{min:550,max:950,step:1},   CAT:{min:650,max:1200,step:1},
  TGT:{min:70,max:200,step:.5},   HD:{min:200,max:450,step:.5},
  W:{min:40,max:180,step:.5},     NFLX:{min:50,max:150,step:.5},
};
function cfg(ticker, price) {
  return BASE_CFG[ticker] ?? { min: Math.round(price*.4/5)*5, max: Math.round(price*1.8/5)*5, step: price>500?5:price>100?.5:.1 };
}

export function TickerCard({ group, price, onPriceChange, filterPlat, tickerSignals }) {
  const { t, pos } = group;
  const visiblePos = filterPlat === 'ALL' ? pos : pos.filter(p => p.plat === filterPlat);
  if (visiblePos.length === 0) return null;

  const c = cfg(t, price);
  const hasShort = visiblePos.some(p => p.dir === 'sc' || p.dir === 'sp');
  const hasLong  = visiblePos.some(p => p.dir === 'lc' || p.dir === 'lp');
  const tag = hasShort && hasLong ? 'Multi-leg' : hasShort ? 'Short' : 'LEAP';

  const totalColl = pos.reduce((s, p) => s + calcCollateral(p.dir, p.k, p.prem, p.qty, price), 0);

  // Worst status across visible positions
  const statusOrder = { danger:0, watch:1, safe:2 };
  const worstStatus = visiblePos.reduce((worst, p) => {
    const { status } = calcStatus(p.dir, p.k, p.prem, price);
    return statusOrder[status] < statusOrder[worst] ? status : worst;
  }, 'safe');

  return (
    <div className={`${styles.card} ${styles[worstStatus]}`}>
      <Header t={t} tag={tag} status={worstStatus} price={price} cfg={c} onPriceChange={onPriceChange} totalColl={totalColl} tickerSignals={tickerSignals} />
      <div className={styles.rows}>
        {visiblePos.map(p => (
          <PositionRow key={p.id} pos={p} price={price} ticker={t} tickerSignals={tickerSignals} />
        ))}
      </div>
    </div>
  );
}

function Header({ t, tag, status, price, cfg, onPriceChange, totalColl, tickerSignals }) {
  const [inputVal, setInputVal] = useState(price.toFixed(2));
  const inputRef = useRef(null);

  // Keep input in sync when price changes externally (slider on another card)
  // but not while user is actively editing
  const editingRef = useRef(false);
  if (!editingRef.current && inputVal !== price.toFixed(2)) {
    setInputVal(price.toFixed(2));
  }

  function commit(val) {
    editingRef.current = false;
    const n = parseFloat(val);
    if (!isNaN(n) && n > 0) onPriceChange(t, n);
    else setInputVal(price.toFixed(2));
  }

  const iv = ((IV[t] ?? .35) * 100).toFixed(0);

  return (
    <div className={`${styles.header} ${styles[`header_${status}`]}`}>
      <div className={styles.headerTop}>
        <div className={styles.headerLeft}>
          <span className={styles.ticker}>{t}</span>
          <StatusBadge status={status} />
          <Badge variant="meta">{tag}</Badge>
          <Badge variant="meta">coll {fk$(totalColl)}</Badge>
        </div>
        <div className={styles.priceInput}>
          <span className={styles.priceLabel}>$</span>
          <input
            ref={inputRef}
            className={styles.priceField}
            type="number"
            value={inputVal}
            step={cfg.step}
            onChange={e => { editingRef.current = true; setInputVal(e.target.value); }}
            onBlur={e => commit(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.target.blur(); } }}
          />
        </div>
      </div>
      <div className={styles.sliderRow}>
        <span className={styles.sliderEdge}>{cfg.min.toLocaleString()}</span>
        <input
          className={styles.slider}
          type="range"
          min={cfg.min} max={cfg.max} step={cfg.step}
          value={Math.min(Math.max(price, cfg.min), cfg.max)}
          onChange={e => { onPriceChange(t, parseFloat(e.target.value)); setInputVal(parseFloat(e.target.value).toFixed(2)); }}
        />
        <span className={`${styles.sliderEdge} ${styles.right}`}>{cfg.max.toLocaleString()}</span>
      </div>
      <div className={styles.ivNote}>
        {(() => {
          const candles = tickerSignals?.D?.candles ?? null;
          const hv = hvFromCandles(candles);
          return hv
            ? `IV ~${(hv*100).toFixed(0)}% from price history · type price + Enter or drag`
            : `IV ~${iv}% estimated · type price + Enter or drag`;
        })()}
      </div>
      <TimeframeDots tickerSignals={tickerSignals} />
    </div>
  );
}

function TimeframeDots({ tickerSignals }) {
  if (!tickerSignals) return null;

  const tfs = ['1H','4H','D','W'];

  function ichSymbol(sig) {
    if (!sig) return '·';
    if (sig.xs ===  2) return '🚀';
    if (sig.xs ===  1) return sig.priceVsCloud === 'in' ? '△' : '▲';
    if (sig.xs === -1) return sig.priceVsCloud === 'in' ? '▽' : '▼';
    if (sig.xs === -2) return '☄️';
    return '·';
  }

  function chipColor(sig) {
    if (!sig) return styles.chipNeutral;
    if (sig.xs ===  2) return styles.chipBull2;
    if (sig.xs ===  1) return styles.chipBull1;
    if (sig.xs === -1) return styles.chipBear1;
    if (sig.xs === -2) return styles.chipBear2;
    return styles.chipNeutral;
  }

  const D = tickerSignals?.D;
  const cloudLabel = D
    ? D.priceVsCloud === 'above' ? '↑ Above Cloud'
    : D.priceVsCloud === 'below' ? '↓ Below Cloud'
    : '~ In Cloud'
    : null;
  const cloudColor = D
    ? D.priceVsCloud === 'above' ? 'var(--green)'
    : D.priceVsCloud === 'below' ? 'var(--red)'
    : 'var(--amber)'
    : 'var(--text3)';

  return (
    <div className={styles.tfRow}>
      <div className={styles.tfChips}>
        {tfs.map(tf => {
          const sig = tickerSignals[tf];
          const since = sig?.since && sig.since > 1
            ? ` (${sig.since >= 100 ? '99+' : sig.since})`
            : '';
          return (
            <div key={tf} className={`${styles.tfChip} ${chipColor(sig)}`}>
              <span className={styles.tfSymbol}>{ichSymbol(sig)}</span>
              <span className={styles.tfLabel}>{tf}{since}</span>
            </div>
          );
        })}
      </div>
      {cloudLabel && (
        <span className={styles.cloudBadge} style={{ color: cloudColor }}>
          {cloudLabel}
        </span>
      )}
    </div>
  );
}

function PositionRow({ pos, price, ticker, tickerSignals }) {
  const {
    lbl, dir, k, exp, dte, qty, prem, plat, note,
    isSpread, spreadWidth, longK
  } = pos;
  const isS = dir === 'sc' || dir === 'sp';
  const { status, be, diff } = calcStatus(dir, k, prem, price);
  const computedIV = hvFromCandles(tickerSignals?.D?.candles ?? null);
  const pnl  = estPnl(ticker, dir, k, dte ?? 0, prem, qty, price, isSpread, longK, spreadWidth, computedIV);
  const exit = calcExit(dir, status, dte, diff, prem, price, k, isSpread, spreadWidth, longK);

  const itmOtm = diff > 0 ? `ITM` : `OTM`;
  const itmAmt = `$${Math.round(Math.abs(diff)).toLocaleString()}`;
  const itmCls = (isS && diff > 0) ? styles.neg
               : (!isS && diff > 0) ? styles.pos
               : styles.muted;

  return (
    <div className={`${styles.row} ${styles[`row_${status}`]}`}>

      {/* ── Left: identity + exit ── */}
      <div className={styles.rowLeft}>
        <div className={styles.rowTop}>
          <StatusBadge status={status} />
          {(dte ?? 999) <= 10 && <Badge variant="dte">{dte}d</Badge>}
          <span className={styles.rowName}>{lbl}</span>
          {isSpread && spreadWidth > 0 && (
            <span className={styles.spreadWidth}>
              ${spreadWidth} wide
            </span>
          )}
          <span className={styles.rowMeta}>{exp} · ×{qty}</span>
          <PlatBadge platform={plat} />
        </div>
        {note && <div className={styles.rowNote}>⚠ {note}</div>}
        {exit && (
          <div className={`${styles.exitLine} ${styles[`exit_${exit.urgency}`]}`}>
            <div className={styles.exitMain}>
              <span className={styles.exitArrow}>
                {exit.urgency==='danger'?'↗':
                 exit.urgency==='watch' ?'→':'✓'}
              </span>
              <span className={styles.exitText}>
                {exit.text}
              </span>
              <span className={`${styles.exitAction} ${styles[`exitAction_${exit.urgency}`]}`}>
                {exit.action}
              </span>
            </div>
            {exit.detail && (
              <div className={styles.exitDetail}>
                {exit.detail}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Right: 4-column metric grid ── */}
      <div className={styles.rowMetrics}>

        <div className={styles.metricCol}>
          <span className={styles.metricLbl}>
            {itmOtm} vs ${Math.round(k).toLocaleString()}
          </span>
          <span className={`${styles.metricVal} ${itmCls}`}>
            {itmAmt}
          </span>
        </div>

        {isS && be ? (
          <div className={styles.metricCol}>
            <span className={styles.metricLbl}>Breakeven</span>
            <span className={styles.metricVal}>
              ${be.toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:2})}
            </span>
          </div>
        ) : isSpread && longK ? (
          <div className={styles.metricCol}>
            <span className={styles.metricLbl}>Cap / Max loss</span>
            <span className={`${styles.metricVal} ${styles.neg}`}>
              -${Math.round((spreadWidth - prem) * 100 * qty).toLocaleString()}
            </span>
          </div>
        ) : (
          <div className={styles.metricCol}>
            <span className={styles.metricLbl}>Cost basis</span>
            <span className={`${styles.metricVal} ${styles.muted}`}>
              -${Math.round(prem * 100 * qty).toLocaleString()}
            </span>
          </div>
        )}

        <div className={styles.metricCol}>
          <span className={styles.metricLbl}>
            {isS ? 'Collected' : 'Paid'}
          </span>
          <span className={`${styles.metricVal} ${isS ? styles.pos : styles.muted}`}>
            {isS ? '+' : '-'}${Math.round(prem * 100 * qty).toLocaleString()}
          </span>
        </div>

        <div className={`${styles.metricCol} ${styles.metricColPnl}`}>
          <span className={styles.metricLbl}>Est P&L</span>
          <span className={`${styles.metricVal} ${styles.metricValLg} ${pnl >= 0 ? styles.pos : styles.neg}`}>
            {pnl >= 0 ? '+' : '-'}${Math.round(Math.abs(pnl)).toLocaleString()}
          </span>
        </div>

      </div>
    </div>
  );
}
