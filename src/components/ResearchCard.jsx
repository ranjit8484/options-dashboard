import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  buildRec, buildLeapRec, getExpiries, getLeapExpiries, getIV
} from '../lib/strikeCalc';
import { loadParams } from '../hooks/useParams';
import { calcStatus, estPnl, f$ } from '../lib/finance';
import { useFundamentals, calcBackdrop,
  useContext } from '../hooks/useFundamentals';
import { EntryChecklist, useChecklistReady } from './EntryChecklist';
import styles from './ResearchCard.module.css';

const CONVICTION_LABELS = {
  full:'Full ★', high:'High', medium:'Medium', low:'Low'
};

// ── Helpers ───────────────────────────────────────────────────────
function ichSym(xs) {
  return xs===2?'🚀':xs===1?'▲':xs===-1?'▽':xs===-2?'☄️':'·';
}

function rsiZoneText(rsi) {
  if (!rsi) return null;
  if (rsi > 76) return `4H RSI ${rsi} — approaching exit zone ⚠`;
  if (rsi >= 63) return `4H RSI ${rsi} — in premium sell zone (63-76) ✓`;
  if (rsi >= 50) return `4H RSI ${rsi} — bullish momentum, not yet in sell zone`;
  if (rsi >= 35) return `4H RSI ${rsi} — neutral zone`;
  return `4H RSI ${rsi} — in call sell zone (24-37) ✓`;
}

// ── Recommended banner ────────────────────────────────────────────
function RecommendedBanner({ conviction, isBull, spot, ticker, params, account, entry }) {
  // Use preferred 14-21 DTE expiry for new trades
  const expiries = getExpiries(3, 5);
  const exp = expiries.find(e => e.preferred) ?? expiries[0];
  if (!exp || !spot) return null;

  const isNaked = conviction === 'full';
  const isCall  = !isBull;
  const delta   = conviction === 'full' ? 0.20
    : conviction === 'high' ? 0.25 : 0.30;
  const longD   = isNaked ? null : delta * 0.45;

  const rec = buildRec({
    spot, ticker, isCall,
    shortDelta: delta,
    longDelta:  longD,
    dte: exp.dte,
    tradeType: isNaked ? 'naked' : 'spread',
    account: account ?? 0,
    conviction, params
  });

  if (!rec) return null;

  const tradeLabel = isNaked
    ? `Sell $${rec.shortStrike} ${isBull ? 'put' : 'call'}`
    : `Sell $${rec.shortStrike}/${rec.longStrike} ${isBull ? 'put' : 'call'} spread`;

  return (
    <div className={styles.recBanner}>
      <span className={styles.recStar}>★ RECOMMENDED</span>
      {entry?.bounce && (
        <span className={styles.recBounce}>↩ bounce entry</span>
      )}
      <span className={styles.recTrade}>{tradeLabel} · {exp.label}</span>
      <span className={styles.recPrem}>~${rec.premium}/share</span>
      <span className={styles.recTarget}>target close: ${(rec.premium * 0.5).toFixed(2)}</span>
      <span className={styles.recBuffer}>{rec.buffer}% buffer</span>
      <span className={styles.recContracts}>max {rec.maxContracts} contracts</span>
    </div>
  );
}

// ── Context panel ─────────────────────────────────────────────────
function ContextPanel({ context }) {
  if (!context) return null;

  const alert  = context.alert;
  const note   = context.weeklyNote;
  const guidance = context.tradeGuidance;
  const earnings = context.earnings;

  // Earnings alert — most urgent
  const earningsAlert = earnings?.daysAway <= 3
    ? {
        level: 'RED',
        message: `⚠ EARNINGS ${
          earnings.daysAway === 0 ? 'TODAY'
          : earnings.daysAway === 1 ? 'TOMORROW'
          : `IN ${earnings.daysAway} DAYS`
        } ${earnings.timing || 'after close'}`
          + ` — ${earnings.expectedMove || ''} move expected`
      }
    : earnings?.daysAway <= 14
    ? {
        level: 'AMBER',
        message: `⚠ Earnings in ${earnings.daysAway}d`
          + ` — elevated risk, size down`
      }
    : null;

  const activeAlert = earningsAlert || alert;

  return (
    <div className={styles.contextPanel}>
      {activeAlert && (
        <div className={`${styles.contextAlert}
          ${activeAlert.level === 'RED'
            ? styles.contextAlertRed
            : styles.contextAlertAmber}`}>
          {activeAlert.message}
        </div>
      )}
      {context.thesis?.summary && (
        <div className={styles.contextRow}>
          <span className={styles.contextLbl}>THESIS</span>
          <span className={styles.contextVal}>
            {context.thesis.summary}
          </span>
        </div>
      )}
      {context.thesis?.keyRisks?.length > 0 && (
        <div className={styles.contextRow}>
          <span className={styles.contextLbl}>RISKS</span>
          <span className={styles.contextVal}>
            {context.thesis.keyRisks.join(' · ')}
          </span>
        </div>
      )}
      {context.tradeGuidance?.postEarnings?.ifMiss && (
        <div className={styles.contextRow}>
          <span className={styles.contextLbl}>IF MISS</span>
          <span className={`${styles.contextVal} ${styles.contextGreen}`}>
            {context.tradeGuidance.postEarnings.ifMiss}
          </span>
        </div>
      )}
      {context.tradeGuidance?.postEarnings?.ifBeat && (
        <div className={styles.contextRow}>
          <span className={styles.contextLbl}>IF BEAT</span>
          <span className={styles.contextVal}>
            {context.tradeGuidance.postEarnings.ifBeat}
          </span>
        </div>
      )}
      {context.tradeGuidance?.postEarnings?.watchFor && (
        <div className={styles.contextRow}>
          <span className={styles.contextLbl}>WATCH</span>
          <span className={`${styles.contextVal} ${styles.contextAmber}`}>
            {context.tradeGuidance.postEarnings.watchFor}
          </span>
        </div>
      )}
      {context.lastUpdated && (
        <div className={styles.contextUpdated}>
          Updated {context.lastUpdated}
        </div>
      )}
    </div>
  );
}

// ── Fundamental backdrop ──────────────────────────────────────────
function FundamentalBackdrop({ ticker, isBull, spot, fundamentals, loading }) {
  if (loading) return (
    <div className={styles.backdropLoading}>
      ⟳ Loading fundamental data...
    </div>
  );

  if (!fundamentals) return (
    <div className={styles.backdropEmpty}>
      No fundamental data available
    </div>
  );

  const bd = calcBackdrop(fundamentals, isBull, spot);
  if (!bd) return null;

  const ratingCls = {
    STRONG:   styles.bdStrong,
    SUPPORTS: styles.bdSupports,
    NEUTRAL:  styles.bdNeutral,
    CAUTION:  styles.bdCaution,
    AGAINST:  styles.bdAgainst,
  }[bd.rating] ?? styles.bdNeutral;

  const ratingIcon = {
    STRONG:   '✅',
    SUPPORTS: '✓',
    NEUTRAL:  '○',
    CAUTION:  '⚠',
    AGAINST:  '🚫',
  }[bd.rating] ?? '○';

  const tradeDir = isBull ? 'bullish' : 'bearish';

  return (
    <div className={`${styles.backdrop_panel} ${ratingCls}`}>

      {/* Rating header */}
      <div className={styles.bdHeader}>
        <span className={styles.bdIcon}>{ratingIcon}</span>
        <span className={styles.bdTitle}>Fundamental Backdrop</span>
        <span className={`${styles.bdRating} ${ratingCls}`}>
          {bd.rating} for {tradeDir}
        </span>
      </div>

      {/* Key metrics row */}
      <div className={styles.bdMetrics}>

        {bd.nextEarnings && (
          <div className={styles.bdMetric}>
            <span className={styles.bdMetricLbl}>Earnings</span>
            <span className={`${styles.bdMetricVal} ${bd.nextEarnings.dte <= 14 ? styles.bdWarn : styles.bdOk}`}>
              {bd.nextEarnings.label} · {bd.nextEarnings.dte}d away
              {bd.nextEarnings.dte <= 14 ? ' ⚠' : ' ✓'}
            </span>
          </div>
        )}

        {bd.analysts && (
          <div className={styles.bdMetric}>
            <span className={styles.bdMetricLbl}>Analysts</span>
            <span className={styles.bdMetricVal}>
              {bd.analysts.bullish} Buy · {bd.analysts.hold} Hold · {bd.analysts.bearish} Sell · {bd.analysts.consensus}
            </span>
          </div>
        )}

        {bd.priceTarget && spot && (
          <div className={styles.bdMetric}>
            <span className={styles.bdMetricLbl}>Target</span>
            <span className={`${styles.bdMetricVal} ${isBull ? bd.priceTarget.mean > spot ? styles.bdOk : styles.bdWarn : bd.priceTarget.mean < spot ? styles.bdOk : styles.bdWarn}`}>
              ${bd.priceTarget.mean.toLocaleString()}
              {' '}({bd.priceTarget.mean > spot ? '+' : ''}
              {Math.round((bd.priceTarget.mean - spot) / spot * 100)}%)
            </span>
          </div>
        )}

        {bd.range52 && (
          <div className={styles.bdMetric}>
            <span className={styles.bdMetricLbl}>52-week</span>
            <span className={styles.bdMetricVal}>
              ${Math.round(bd.range52.low).toLocaleString()} — ${Math.round(bd.range52.high).toLocaleString()}
            </span>
          </div>
        )}

      </div>

      {/* Supports list */}
      {bd.supports.length > 0 && (
        <div className={styles.bdPoints}>
          {bd.supports.map((s, i) => (
            <div key={i} className={styles.bdSupport}>✓ {s}</div>
          ))}
        </div>
      )}

      {/* Warnings list */}
      {bd.warnings.length > 0 && (
        <div className={styles.bdPoints}>
          {bd.warnings.map((w, i) => (
            <div key={i} className={styles.bdWarning}>⚠ {w}</div>
          ))}
        </div>
      )}

    </div>
  );
}

// ── Primary decision ──────────────────────────────────────────────
function getPrimaryDecision(strategy, sig, entry) {
  if (!strategy || !entry) return null;

  const wKijun  = sig.W?.kijunDist ?? 0;
  const dRsiDiv = sig.D?.rsiDivergence ?? false;
  const wRsiDiv = sig.W?.rsiDivergence ?? false;
  const wSince  = sig.W?.since ?? 0;
  const isBear  = entry.dir === 'short';
  const isBull  = entry.dir === 'put' || entry.dir === 'long';

  // Explicit no trade
  if (strategy.noTrade) {
    return {
      label:  'SIT THIS OUT',
      style:  'none',
      reason: strategy.description
    };
  }

  // Bear move mature — deeply oversold
  if (isBear && wKijun < -15) {
    return {
      label:  'WATCH — Bear Mature',
      style:  'watch',
      reason: `Stock -${Math.abs(wKijun).toFixed(0)}% below weekly Kijun. ` +
        `Bear move largely played out after ${wSince} weekly candles. ` +
        `Wait for bounce entry or bull reversal signal.`
    };
  }

  // Bull move mature — deeply overbought
  if (isBull && wKijun > 15) {
    return {
      label:  'WATCH — Bull Extended',
      style:  'watch',
      reason: `Stock +${wKijun.toFixed(0)}% above weekly Kijun. ` +
        `Bull move extended after ${wSince} weekly candles. ` +
        `Wait for pullback entry before selling puts.`
    };
  }

  // RSI diverging — reduce conviction
  if (dRsiDiv || wRsiDiv) {
    if (strategy.conviction === 'full' || strategy.conviction === 'high') {
      return {
        label:  'CAUTION — RSI Diverging',
        style:  'caution',
        reason: `Price making new ${isBear ? 'lows' : 'highs'} ` +
          `but RSI not confirming. Momentum weakening. ` +
          `Reduce size by 50% or wait for RSI to align.`
      };
    }
  }

  // Extension warning from strategy
  if (strategy.extensionWarning) {
    return {
      label:  'CAUTION — Extended',
      style:  'caution',
      reason: strategy.extensionWarning
    };
  }

  // Fresh signal with bounce — ideal entry
  if (entry.bounce) {
    const conv = strategy.conviction;
    return {
      label: conv === 'full'
        ? '🎯 ENTER NOW — Bounce Entry'
        : '📍 READY — Bounce Entry',
      style:  'ready',
      reason: strategy.description
    };
  }

  // Full or high conviction — ready
  if (strategy.conviction === 'full') {
    return {
      label:  '🟢 READY — ' + strategy.thesis,
      style:  'ready',
      reason: strategy.description
    };
  }
  if (strategy.conviction === 'high') {
    return {
      label:  '📍 READY — ' + strategy.thesis,
      style:  'ready',
      reason: strategy.description
    };
  }

  // Medium conviction — watch
  if (strategy.conviction === 'medium') {
    return {
      label:  '⏳ WATCH — ' + strategy.thesis,
      style:  'watch',
      reason: strategy.description
    };
  }

  // Low conviction — wait
  return {
    label:  '◐ WAIT — Low Conviction',
    style:  'wait',
    reason: strategy.description ?? 'Signal not strong enough yet.'
  };
}

function PrimaryDecision({ decision }) {
  if (!decision) return null;
  const styleMap = {
    ready:   styles.decisionReady,
    watch:   styles.decisionWatch,
    caution: styles.decisionCaution,
    wait:    styles.decisionWait,
    none:    styles.decisionNone,
  };
  return (
    <div className={`${styles.primaryDecision} ${styleMap[decision.style] ?? ''}`}>
      <div className={styles.decisionLabel}>{decision.label}</div>
      {decision.reason && (
        <div className={styles.decisionReason}>{decision.reason}</div>
      )}
    </div>
  );
}

// ── Why section ───────────────────────────────────────────────────
function WhySection({ ticker, sig, entry, strategy }) {
  if (!sig || !entry) return null;
  const D=sig.D, W=sig.W, h4=sig['4H'], h1=sig['1H'];

  const tfs = [{key:'W',s:W},{key:'D',s:D},{key:'4H',s:h4},{key:'1H',s:h1}];
  const allBull = tfs.every(t=>t.s&&t.s.xs>=1);
  const allBear = tfs.every(t=>t.s&&t.s.xs<=-1);
  const cloud = D?.priceVsCloud==='above'?'above':D?.priceVsCloud==='below'?'below':'inside';

  const isBull = (entry.action==='SELL'&&entry.dir==='put')
    ||(entry.action==='ENTER'&&entry.dir==='long')
    ||(entry.action==='WATCH'&&entry.dir==='long');

  const invalidation = isBull
    ? '4H MACD bear cross · Daily closes below Kijun Sen · 4H RSI drops below 50'
    : '4H MACD bull cross · Daily closes above Kijun Sen · 4H RSI rises above 50';

  return (
    <div className={styles.whySection}>
      <PrimaryDecision decision={
        getPrimaryDecision(strategy, sig, entry)
      } />
      <div className={styles.whyRow}>
        <span className={styles.whyLabel}>Signals</span>
        <div className={styles.whyVal}>
          {tfs.map(tf=>(
            <span key={tf.key} className={styles.tfSig}>
              {tf.key} {ichSym(tf.s?.xs)}
              {tf.s?.since>1?` (${tf.s.since})`:''}{' '}
            </span>
          ))}
        </div>
      </div>
      <div className={styles.whyRow}>
        <span className={styles.whyLabel}>Cloud</span>
        <span className={`${styles.whyVal}
          ${cloud==='above'?styles.bull:cloud==='below'?styles.bear:styles.neutral}`}>
          Price {cloud} Ichimoku cloud on Daily
          {allBull?' · All timeframes bullish':allBear?' · All timeframes bearish':''}
        </span>
      </div>
      {h4?.rsi && (
        <div className={styles.whyRow}>
          <span className={styles.whyLabel}>Timing</span>
          <span className={styles.whyVal}>{rsiZoneText(h4.rsi)}</span>
        </div>
      )}
      {D?.since>1 && (
        <div className={styles.whyRow}>
          <span className={styles.whyLabel}>Duration</span>
          <span className={styles.whyVal}>
            {D.since} daily candles
            {D.since>20?' — mature, stable':D.since>10?' — developing':' — fresh signal'}
          </span>
        </div>
      )}
      {/* Entry timing guidance */}
      {(() => {
        const h4 = sig['4H'];
        const h1 = sig['1H'];
        if (!h4 || !entry) return null;

        const h4BearishCandles = h4.xs <= -1 && h4.since > 5;
        const h4BullishCandles = h4.xs >= 1  && h4.since > 5;
        const h1Oversold   = h1?.rsi && h1.rsi < 35;
        const h1Overbought = h1?.rsi && h1.rsi > 65;
        const h4Oversold   = h4.rsi && h4.rsi < 35;
        const h4Overbought = h4.rsi && h4.rsi > 65;

        if (!isBull && h4BearishCandles) {
          const kijun = h4.kijun;
          const bounceTarget = kijun
            ? `$${Math.round(kijun)}-${Math.round(kijun * 1.01)}`
            : 'Kijun level';
          const waitForBounce = h4Oversold || h1Oversold;
          return (
            <div className={`${styles.whyRow} ${waitForBounce ? styles.entryWaitRow : styles.entryReadyRow}`}>
              <span className={styles.whyLabel}>{waitForBounce ? '⏳ Entry' : '📍 Entry'}</span>
              <span className={styles.whyVal}>
                {waitForBounce
                  ? `Wait for bounce to ${bounceTarget} · then sell calls on 1H bear cross`
                  : `4H in sell zone · enter on next 1H MACD bear cross`
                }
              </span>
            </div>
          );
        }

        if (isBull && h4BullishCandles) {
          const kijun = h4.kijun;
          const dipTarget = kijun
            ? `$${Math.round(kijun * 0.99)}-${Math.round(kijun)}`
            : 'Kijun level';
          const waitForDip = h4Overbought || h1Overbought;
          return (
            <div className={`${styles.whyRow} ${waitForDip ? styles.entryWaitRow : styles.entryReadyRow}`}>
              <span className={styles.whyLabel}>{waitForDip ? '⏳ Entry' : '📍 Entry'}</span>
              <span className={styles.whyVal}>
                {waitForDip
                  ? `Wait for dip to ${dipTarget} · then sell puts on 1H bull cross`
                  : `4H in buy zone · enter on next 1H MACD bull cross`
                }
              </span>
            </div>
          );
        }

        if (h4.since <= 3) {
          return (
            <div className={`${styles.whyRow} ${styles.entryReadyRow}`}>
              <span className={styles.whyLabel}>📍 Entry</span>
              <span className={styles.whyVal}>Fresh 4H signal · enter now with 14-21 DTE</span>
            </div>
          );
        }

        return null;
      })()}
      {sig.D?.kijunDist !== undefined && (
        <div className={styles.whyRow}>
          <span className={styles.whyLabel}>Extension</span>
          <span className={`${styles.whyVal} ${Math.abs(sig.D.kijunDist) > 15 ? styles.bear : styles.bull}`}>
            {sig.D.kijunDist > 0 ? '+' : ''}{sig.D.kijunDist.toFixed(1)}% from Kijun
            {Math.abs(sig.D.kijunDist) > 25
              ? ' ⚠ Extreme — avoid new positions'
              : Math.abs(sig.D.kijunDist) > 15
              ? ' ⚠ Extended — reduce size'
              : ' ✓ Within normal range'}
          </span>
        </div>
      )}
      {(sig.D?.rsiDivergence || sig.W?.rsiDivergence) && (
        <div className={styles.whyRow}>
          <span className={styles.whyLabel}>RSI</span>
          <span className={`${styles.whyVal} ${styles.bear}`}>
            ⚠ Divergence detected — price and momentum disagree, trend may be losing strength
          </span>
        </div>
      )}
      {strategy?.extensionWarning && (
        <div className={`${styles.whyRow} ${styles.extWarnRow}`}>
          <span className={styles.whyLabel}>Warning</span>
          <span className={`${styles.whyVal} ${styles.bear}`}>
            ⚠ {strategy.extensionWarning}
          </span>
        </div>
      )}
      {W && (
        <div className={styles.whyRow}>
          <span className={styles.whyLabel}>Weekly</span>
          <span className={`${styles.whyVal} ${W.xs>=1?styles.bull:W.xs<=-1?styles.bear:styles.neutral}`}>
            {W.xs===2?'🚀 Strong bull — full conviction, naked appropriate'
             :W.xs===1?'▲ Bull confirms — credit spread appropriate'
             :W.xs===-1?'▽ Bear — follow bearish signals only'
             :W.xs===-2?'☄️ Strong bear — full conviction short'
             :'Neutral — use spreads over naked'}
          </span>
        </div>
      )}
      <div className={`${styles.whyRow} ${styles.invalidRow}`}>
        <span className={styles.whyLabel}>Exit if</span>
        <span className={styles.whyVal}>{invalidation}</span>
      </div>
      <div className={styles.whyRow}>
        <span className={styles.whyLabel}>Hold plan</span>
        <span className={styles.whyVal}>
          Open 14-21 DTE · close at 50% profit or with 7 DTE remaining · max hold 10 days
        </span>
      </div>
      {strategy?.description && (
        <div className={`${styles.whyRow} ${styles.descRow}`}>
          <span className={styles.whyLabel}>Signal means</span>
          <span className={`${styles.whyVal} ${styles.descVal}`}>
            {strategy.description}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Trade row ─────────────────────────────────────────────────────
function TradeRow({ rec, label, isNaked, isBull, isRecommended, preferred }) {
  if (!rec) return null;
  const optType = isBull ? 'put' : 'call';
  return (
    <div className={`${styles.tradeRow} ${isRecommended?styles.tradeRec:''}`}>
      {isRecommended && <div className={styles.tradeRecLabel}>★ Best for this signal</div>}
      <div className={styles.tradeTop}>
        <span className={styles.tradeExpiry}>
          {label}
          {preferred && <span className={styles.preferredBadge}>★ ideal</span>}
        </span>
        <span className={styles.tradeStrike}>
          {isNaked
            ? `Sell $${rec.shortStrike} ${optType}`
            : `Sell $${rec.shortStrike} / Buy $${rec.longStrike} ${optType} spread`}
        </span>
        <span className={styles.tradePrem}>~${rec.premium}/sh</span>
        <span className={styles.tradeTotal}>+${rec.premiumTotal.toLocaleString()}</span>
      </div>
      <div className={styles.tradeMetrics}>
        <Metric label="Buffer"    val={`${rec.buffer}%`} />
        <Metric label="B/E"       val={`$${parseFloat(rec.breakeven).toLocaleString()}`} />
        <Metric label="Delta"     val={rec.delta} />
        {rec.maxLoss
          ? <Metric label="Max loss" val={`-$${rec.maxLoss.toLocaleString()}`} cls={styles.neg} />
          : <Metric label="Margin"   val={`~$${rec.margin.toLocaleString()}`} />
        }
        <Metric label="Contracts" val={rec.maxContracts} cls={styles.pos} />
        <Metric label="Ann yield" val={`${rec.annYield}%`} cls={styles.pos} />
      </div>
    </div>
  );
}

function Metric({ label, val, cls='' }) {
  return (
    <div className={styles.tm}>
      <span className={styles.tml}>{label}</span>
      <span className={`${styles.tmv} ${cls}`}>{val}</span>
    </div>
  );
}

// ── IV override input ─────────────────────────────────────────────
function IvInput({ ticker, ivOverride, setIvOverride }) {
  const base = (getIV(ticker)*100).toFixed(0);
  return (
    <div className={styles.ivOverride}>
      <span className={styles.ivLabel}>IV</span>
      <input
        className={styles.ivInput}
        type="number"
        min={5} max={300} step={1}
        value={ivOverride}
        onChange={e => setIvOverride(Number(e.target.value))}
      />
      <span className={styles.ivPct}>%</span>
      {ivOverride !== Number(base) && (
        <button className={styles.ivReset}
          onClick={() => setIvOverride(Number(base))}>
          reset ({base}%)
        </button>
      )}
      <span className={styles.ivHint}>override from broker</span>
      <span className={styles.ivHint}>· estimated from price history</span>
    </div>
  );
}

// ── Naked tab ─────────────────────────────────────────────────────
function NakedTab({ ticker, spot, isBull, conviction, account, params, ivOverride, sig, fundamentals }) {
  const [delta, setDelta] = useState(
    conviction==='full'?20:conviction==='high'?25:30
  );
  const isCall  = !isBull;
  const expiries = getExpiries(2, 5);
  const iv = ivOverride / 100;

  const recs = useMemo(() => expiries.map((exp,i) => ({
    exp, i,
    rec: buildRec({ spot, ticker, isCall,
      shortDelta: delta/100, longDelta: null,
      dte: exp.dte, tradeType: 'naked',
      account, conviction, params, ivOverride: iv })
  })), [spot, ticker, isCall, delta, conviction, account, ivOverride]);

  const validRecs = recs.filter(r => r.rec !== null);
  const firstRec = validRecs[0]?.rec ?? null;
  const { ready, caution, blocked } =
    useChecklistReady(sig, spot, fundamentals, 'naked', firstRec);

  return (
    <div className={styles.tabContent}>
      <EntryChecklist
        sig={sig}
        spot={spot}
        fundamentals={fundamentals}
        tradeType="naked"
        firstRec={firstRec}
      />
      <div className={blocked ? styles.gated : ''}>
        {blocked && (
          <div className={styles.gatedMsg}>
            Resolve conditions above before selecting strikes
          </div>
        )}
        <div className={`${styles.sliderRow} ${blocked ? styles.gatedContent : ''}`}>
          <span className={styles.sliderLbl}>Delta</span>
          <input type="range" min={10} max={40} step={5}
            value={delta} onChange={e=>setDelta(Number(e.target.value))}
            className={styles.slider}
            disabled={blocked} />
          <span className={styles.sliderVal}>{delta}</span>
          <span className={styles.sliderHint}>
            {delta<=15?'Conservative':delta<=25?'Moderate':'Aggressive'}
          </span>
        </div>
        {!blocked && (validRecs.length === 0 ? (
          <div className={styles.noRecs}>
            No valid strikes found — IV too low or premium below minimum for this stock price. Try adjusting IV above.
          </div>
        ) : validRecs.map(({exp,rec,i}) => (
          <TradeRow key={exp.label} rec={rec} label={exp.label}
            isNaked={true} isBull={isBull}
            isRecommended={i===0&&conviction==='full'}
            preferred={exp.preferred} />
        )))}
      </div>
      <div className={styles.exitRule}>
        Close at 50% profit · Roll if breached with 5+ DTE remaining
      </div>
    </div>
  );
}

// ── Spread tab ────────────────────────────────────────────────────
function SpreadTab({ ticker, spot, isBull, conviction, account, params, ivOverride, sig, fundamentals }) {
  const [shortDelta, setShortDelta] = useState(
    conviction==='full'?35:conviction==='high'?30:25
  );
  const longDelta = Math.round(shortDelta*0.45);
  const isCall = !isBull;
  const expiries = getExpiries(3, 10);
  const iv = ivOverride / 100;

  const recs = useMemo(() => expiries.map((exp,i) => ({
    exp, i,
    rec: buildRec({ spot, ticker, isCall,
      shortDelta:shortDelta/100, longDelta:longDelta/100,
      dte:exp.dte, tradeType:'spread',
      account, conviction, params, ivOverride:iv })
  })), [spot, ticker, isCall, shortDelta, conviction, account, ivOverride]);

  const validRecs = recs.filter(r => r.rec !== null);
  const firstRec = validRecs[0]?.rec ?? null;
  const { ready, caution, blocked } =
    useChecklistReady(sig, spot, fundamentals, 'spread', firstRec);

  return (
    <div className={styles.tabContent}>
      <EntryChecklist
        sig={sig}
        spot={spot}
        fundamentals={fundamentals}
        tradeType="spread"
        firstRec={firstRec}
      />
      <div className={blocked ? styles.gated : ''}>
        {blocked && (
          <div className={styles.gatedMsg}>
            Resolve conditions above before selecting strikes
          </div>
        )}
        <div className={`${styles.sliderRow} ${blocked ? styles.gatedContent : ''}`}>
          <span className={styles.sliderLbl}>Short Δ</span>
          <input type="range" min={15} max={45} step={5}
            value={shortDelta} onChange={e=>setShortDelta(Number(e.target.value))}
            className={styles.slider}
            disabled={blocked} />
          <span className={styles.sliderVal}>{shortDelta}/{longDelta}</span>
          <span className={styles.sliderHint}>
            {shortDelta>=35?'Aggressive 40/20':shortDelta>=28?'Moderate 30/15':'Conservative 25/12'}
          </span>
        </div>
        {!blocked && (validRecs.length === 0 ? (
          <div className={styles.noRecs}>
            No valid strikes found — IV too low or premium below minimum for this stock price. Try adjusting IV above.
          </div>
        ) : validRecs.map(({exp,rec,i}) => (
          <TradeRow key={exp.label} rec={rec} label={exp.label}
            isNaked={false} isBull={isBull}
            isRecommended={i===1&&(conviction==='high'||conviction==='medium')}
            preferred={exp.preferred} />
        )))}
      </div>
      <div className={styles.exitRule}>
        Close at 50% profit · Roll short leg if breached with 5+ DTE
      </div>
    </div>
  );
}

// ── Manage tab (active positions on this ticker) ──────────────────
function ManageTab({ positions, price, ticker, sig }) {
  if (!positions?.length) return (
    <div className={styles.tabContent}>
      <div className={styles.noPositions}>No active positions on {ticker}</div>
    </div>
  );

  return (
    <div className={styles.tabContent}>

      {/* ── LEAP Harvest Opportunities ── */}
      {(() => {
        const leaps = positions.filter(p =>
          (p.dir === 'lc' || p.dir === 'lp') && (p.dte ?? 0) > 60
        );
        if (leaps.length === 0) return null;

        // Map shorts to LEAPs by index
        // so each LEAP knows if it has a harvest
        const allShorts = positions.filter(p =>
          (p.dir === 'sc' || p.dir === 'sp') && (p.dte ?? 0) > 0
        );

        // Compute harvest signal once (shared for ticker)
        const h4Xs = sig?.['4H']?.xs ?? 0;
        const h1Xs = sig?.['1H']?.xs ?? 0;
        const wXs  = sig?.W?.xs  ?? 0;
        const dXs  = sig?.D?.xs  ?? 0;

        return leaps.map((leap, leapIdx) => {
          const isCallLeap  = leap.dir === 'lc';
          const activeHedge = allShorts[leapIdx] ?? null;

          const opposing = isCallLeap
            ? (h4Xs <= -1 || h1Xs <= -1)
            : (h4Xs >= 1  || h1Xs >= 1);
          const aligned  = isCallLeap
            ? (h4Xs >= 1  && h1Xs >= 1)
            : (h4Xs <= -1 && h1Xs <= -1);
          const bigMove  = isCallLeap
            ? (dXs >= 2 && wXs >= 2)
            : (dXs <= -2 && wXs <= -2);

          let signal, signalCls, action, detail;

          if (bigMove) {
            signal    = '🚫 SKIP HARVEST';
            signalCls = styles.harvestSkip;
            action    = 'Strong signal in LEAP direction';
            detail    = 'Do not sell premium — let LEAP run this cycle';
          } else if (opposing) {
            signal    = '⚡ AGGRESSIVE HARVEST';
            signalCls = styles.harvestAgg;
            action    = isCallLeap
              ? 'Short-term bearish — sell call closer to money'
              : 'Short-term bullish — sell put closer to money';
            detail    = '4H/1H opposing LEAP — elevated premium, more buffer';
          } else if (aligned) {
            signal    = '◐ CONSERVATIVE HARVEST';
            signalCls = styles.harvestCon;
            action    = isCallLeap
              ? 'Sell far OTM call — protect upside'
              : 'Sell far OTM put — protect downside';
            detail    = '4H/1H aligned with LEAP — stay far OTM';
          } else {
            signal    = '○ MODERATE HARVEST';
            signalCls = styles.harvestMod;
            action    = isCallLeap
              ? 'Sell 25-delta call, 2-3 weeks out'
              : 'Sell 25-delta put, 2-3 weeks out';
            detail    = 'Neutral short-term — standard harvest cycle';
          }

          return (
            <div key={`harvest-${leapIdx}`} className={styles.harvestPanel}>
              <div className={styles.harvestHeader}>
                <span className={styles.harvestTitle}>💰 LEAP Harvest</span>
                <span className={`${styles.harvestSignal} ${signalCls}`}>
                  {signal}
                </span>
              </div>
              <div className={styles.harvestLeap}>
                <span className={styles.harvestLeapLbl}>{leap.lbl}</span>
                <span className={styles.harvestLeapMeta}>
                  {leap.exp} · {leap.dte}d left · {leap.plat}
                </span>
              </div>
              <div className={styles.harvestAction}>{action}</div>
              <div className={styles.harvestDetail}>{detail}</div>
              {activeHedge ? (
                <div className={styles.harvestActive}>
                  ✓ Active: {activeHedge.lbl} · {activeHedge.exp} · {activeHedge.dte}d left
                </div>
              ) : bigMove ? null : (
                <div className={styles.harvestMissing}>
                  ⚠ No harvest open — sell a short{isCallLeap ? ' call' : ' put'} against this LEAP now
                </div>
              )}
            </div>
          );
        });
      })()}

      {/* ── Existing position rows (unchanged) ── */}
      {positions.map((p, i) => {
        const { status, be, diff } = calcStatus(p.dir, p.k, p.prem, price);
        const pnl = estPnl(ticker, p.dir, p.k, p.dte??0, p.prem, p.qty, price);
        const isShort = p.dir==='sc'||p.dir==='sp';
        const dte = p.dte ?? 0;
        const itmOtm = diff>0?'ITM':'OTM';

        const isSpread    = p.isSpread ?? false;
        const spreadWidth = p.spreadWidth ?? 0;
        const longK       = p.longK ?? 0;
        const bufferToStrike = Math.abs(price - p.k);
        const bufferPct   = price > 0
          ? (bufferToStrike / price * 100).toFixed(1) : '0';
        const atRisk      = diff > 0;

        // Roll recommendation
        let rollRec = null;

        if (isSpread && isShort) {
          const halfProfit = p.prem * 0.5;
          if (atRisk && dte <= 5) {
            rollRec = { urgency:'danger',
              action: 'Close immediately — breached + expiring',
              detail: `Max loss $${Math.round((spreadWidth-p.prem)*100).toLocaleString()} if held`
            };
          } else if (atRisk) {
            rollRec = { urgency:'danger',
              action: 'Close or roll — short strike breached',
              detail: `Roll to wider/later spread · close if < 5 DTE`
            };
          } else if (bufferToStrike < spreadWidth * 0.3) {
            rollRec = { urgency:'watch',
              action: `Watch — only $${Math.round(bufferToStrike)} from strike`,
              detail: `Close if daily close above $${p.k} · 50% profit = $${Math.round(halfProfit*100).toLocaleString()}`
            };
          } else if (dte <= 5) {
            rollRec = { urgency:'watch',
              action: `${dte}d left — gamma risk`,
              detail: `Close if $${p.k} threatened · let expire if ${bufferPct}% holds`
            };
          } else {
            const profitPct = p.prem > 0
              ? Math.round((1-(Math.max(0,diff)/p.prem))*100) : 0;
            rollRec = profitPct >= 50
              ? { urgency:'safe',
                  action: `Close — ${profitPct}% profit achieved`,
                  detail: `50%+ target hit · close now or set limit` }
              : { urgency:'safe',
                  action: 'Hold to 50% profit target',
                  detail: `Close if daily close above $${p.k} · target: $${Math.round(halfProfit*100).toLocaleString()}`
                };
          }
        } else if (isShort) {
          if (status==='danger') {
            rollRec = { urgency:'danger',
              action: dte<=7 ? 'Roll immediately — ITM at expiry' : 'Roll up/out 2-4 weeks',
              detail: `Consider rolling to ${p.dir==='sc'?'higher':'lower'} strike`
            };
          } else if (status==='watch') {
            rollRec = { urgency:'watch',
              action: dte<=5 ? 'Decide: roll or let expire' : 'Monitor — roll if breaches strike',
              detail: `${dte} days remaining`
            };
          } else {
            const profPct = pnl>0&&p.prem>0
              ? Math.round(pnl/(p.prem*100*p.qty)*100) : 0;
            rollRec = { urgency:'safe',
              action: profPct>=50
                ? `Close at ${profPct}% profit`
                : `Hold to 50% profit (${profPct}% so far)`,
              detail: `${dte} days remaining`
            };
          }
        } else {
          if (dte>0&&dte<60) {
            rollRec = { urgency:'watch',
              action:'Roll forward — losing time value fast',
              detail:`Only ${dte} days left on this LEAP` };
          } else {
            rollRec = { urgency:'safe',
              action:'Hold — sell short-term premium against this LEAP',
              detail:`${dte} days remaining, theta working slowly` };
          }
        }

        return (
          <div key={i} className={`${styles.manageRow} ${styles[`manage_${status}`]}`}>
            <div className={styles.manageTop}>
              <span className={styles.manageLbl}>{p.lbl}</span>
              <span className={styles.manageMeta}>{p.exp} · ×{p.qty} · {p.plat}</span>
              <span className={`${styles.manageItm}
                ${status==='danger'?styles.neg:status==='watch'?styles.amber:styles.pos}`}>
                {itmOtm} ${Math.round(Math.abs(diff)).toLocaleString()}
              </span>
            </div>
            <div className={styles.manageMetrics}>
              <Metric label="Status"    val={status.toUpperCase()}
                cls={status==='danger'?styles.neg:status==='watch'?styles.amber:styles.pos} />
              <Metric label="Est P&L"   val={`${pnl>=0?'+':'-'}$${Math.round(Math.abs(pnl)).toLocaleString()}`}
                cls={pnl>=0?styles.pos:styles.neg} />
              {be && isShort && <Metric label="B/E" val={`$${be.toLocaleString(undefined,{maximumFractionDigits:0})}`} />}
              <Metric label="DTE"       val={`${dte}d`} />
            </div>
            {rollRec && (
              <div className={`${styles.rollRec} ${styles[`roll_${rollRec.urgency}`]}`}>
                <span className={styles.rollArrow}>
                  {rollRec.urgency==='danger'?'↗':rollRec.urgency==='watch'?'→':'✓'}
                </span>
                <div>
                  <div className={styles.rollAction}>{rollRec.action}</div>
                  <div className={styles.rollDetail}>{rollRec.detail}</div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── LEAP tab ─────────────────────────────────────────────────────
function LeapTab({ ticker, spot, isBull, sig, fundamentals }) {
  const expiries = getLeapExpiries().filter(e => e.months >= 3);
  const [expiryIdx, setExpiryIdx] = useState(
    Math.max(0, expiries.findIndex(e => e.months >= 6))
  );
  const exp = expiries[expiryIdx] ?? expiries[0];

  const recs = useMemo(() =>
    exp ? buildLeapRec({ spot, ticker, isCall: isBull, dte: exp.dte }) : [],
    [spot, ticker, isBull, exp?.dte]
  );

  const { ready, caution, blocked } =
    useChecklistReady(sig, spot, fundamentals, 'leap', null);

  const tierStyle = {
    aggressive:   styles.tierAgg,
    moderate:     styles.tierMod,
    conservative: styles.tierCon,
  };

  return (
    <div className={styles.tabContent}>
      <EntryChecklist
        sig={sig}
        spot={spot}
        fundamentals={fundamentals}
        tradeType="leap"
        firstRec={null}
      />
      <div className={styles.leapDirection}>
        {isBull
          ? '🚀 Long Call — ride the upside'
          : '🚀 Long Put — ride the downside'}
        <span className={styles.leapDirHint}>
          Auto-selected from signal direction
        </span>
      </div>

      <div className={styles.expiryPills}>
        {expiries.map((e, i) => (
          <button key={e.label}
            className={`${styles.expiryPill} ${i===expiryIdx?styles.expiryActive:''}`}
            onClick={() => setExpiryIdx(i)}>
            {e.label}
            {e.months >= 6 && <span className={styles.preferred}>★</span>}
          </button>
        ))}
      </div>

      {!blocked && recs.map(r => (
        <div key={r.tier} className={`${styles.leapRec} ${tierStyle[r.tier] ?? ''}`}>
          <div className={styles.leapRecTop}>
            <span className={styles.leapTier}>{r.tier}</span>
            <span className={styles.leapStrike}>
              Buy ${r.strike} {isBull ? 'call' : 'put'}
            </span>
            <span className={styles.leapCost}>~${r.cost}/share</span>
            <span className={styles.leapCostTotal}>${r.costTotal.toLocaleString()} total</span>
            <span className={styles.leapDelta}>Δ {r.delta}</span>
          </div>
          <div className={styles.leapMetrics}>
            <div className={styles.tm}>
              <span className={styles.tml}>Breakeven</span>
              <span className={styles.tmv}>
                ${parseFloat(r.breakeven).toLocaleString()} ({r.beMove > 0 ? '+' : ''}{r.beMove}%)
              </span>
            </div>
            <div className={styles.tm}>
              <span className={styles.tml}>+30% move</span>
              <span className={`${styles.tmv} ${parseFloat(r.ret30) > 0 ? styles.pos : styles.neg}`}>
                {r.ret30}% return
              </span>
            </div>
            <div className={styles.tm}>
              <span className={styles.tml}>+50% move</span>
              <span className={`${styles.tmv} ${parseFloat(r.ret50) > 0 ? styles.pos : styles.neg}`}>
                {r.ret50}% return
              </span>
            </div>
          </div>
        </div>
      ))}

      <div className={styles.exitRule}>
        ★ Preferred: 6+ months · Close at 80%+ profit or roll if DTE &lt; 60
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────
export function ResearchCard({
  ticker, spot: spotProp, sig, onClose,
  activePositions, balances
}) {
  const params  = loadParams();
  const account = (balances?.rh??0) + (balances?.fid??0);
  const { data: fundamentals, loading: fundLoading } = useFundamentals(ticker);
  const { data: context } = useContext(ticker);

  const defaultIv = Math.round(getIV(ticker) * 100);
  const [ivOverride, setIvOverride] = useState(defaultIv);

  if (!sig) return null;

  // Fallback spot: use first active position strike or signal-derived estimate
  const spot = spotProp
    || activePositions?.[0]?.k
    || 100;

  const entry      = sig._entry;
  const strategy   = sig._strategy;
  const conviction = strategy?.conviction ?? 'medium';
  const thesis     = strategy?.thesis ?? '—';

  const isBull = (entry?.action==='SELL'&&entry?.dir==='put')
    ||(entry?.action==='ENTER'&&entry?.dir==='long')
    ||(entry?.action==='WATCH'&&entry?.dir==='long');

  const hasPositions = activePositions?.length > 0;
  const noTrade = strategy?.noTrade === true && !hasPositions;

  // Auto-select default tab based on conviction and positions
  const defaultTab = hasPositions ? 'manage' : 'why';
  const [activeTab, setActiveTab] = useState(defaultTab);

  const tabs = [
    { id:'why',    label:'📋 Thesis' },
    ...(hasPositions
      ? [{ id:'manage', label:`⚡ Manage (${activePositions.length})` }]
      : []),
    ...(!noTrade ? [
      { id:'naked',  label: isBull ? '💰 Naked Put' : '💰 Naked Call',
        badge: conviction==='full' ? '★' : null },
      { id:'spread', label: isBull ? '📊 Put Spread' : '📊 Call Spread',
        badge: conviction!=='full' && conviction!=='none' ? '★' : null },
      { id:'leap',   label: isBull ? '🚀 Call LEAP' : '🚀 Put LEAP' },
    ] : []),
  ];

  return createPortal(
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.card} onClick={e=>e.stopPropagation()}>

        {/* Header */}
        <div className={styles.cardHeader}>
          <div className={styles.cardHeaderLeft}>
            <span className={styles.cardTicker}>{ticker}</span>
            <span className={`${styles.convBadge} ${styles[`conv_${conviction}`]}`}>
              {CONVICTION_LABELS[conviction]??conviction}
            </span>
            <span className={styles.cardThesis}>{thesis}</span>
            {fundamentals && (() => {
              const bd = calcBackdrop(fundamentals, isBull, spot);
              if (!bd) return null;
              const cls = {
                STRONG:   styles.hdrBdStrong,
                SUPPORTS: styles.hdrBdSupports,
                NEUTRAL:  styles.hdrBdNeutral,
                CAUTION:  styles.hdrBdCaution,
                AGAINST:  styles.hdrBdAgainst,
              }[bd.rating] ?? styles.hdrBdNeutral;
              return (
                <span className={`${styles.hdrBdBadge} ${cls}`}>
                  {bd.rating === 'STRONG'   ? '✅ Strong'
                  :bd.rating === 'SUPPORTS' ? '✓ Supports'
                  :bd.rating === 'NEUTRAL'  ? '○ Neutral'
                  :bd.rating === 'CAUTION'  ? '⚠ Caution'
                  : '🚫 Against'}
                </span>
              );
            })()}
            {hasPositions && (
              <span className={styles.activePill}>● Active</span>
            )}
          </div>
          <div className={styles.cardHeaderRight}>
            <span className={styles.cardPrice}>
              ${spot?.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}
            </span>
            <button className={styles.closeBtn} onClick={onClose}>✕</button>
          </div>
        </div>

        {/* IV override */}
        <div className={styles.ivBar}>
          <IvInput ticker={ticker}
            ivOverride={ivOverride}
            setIvOverride={setIvOverride} />
        </div>

        {/* Tabs */}
        <div className={styles.tabNav}>
          {tabs.map(t=>(
            <button key={t.id}
              className={`${styles.tabBtn} ${activeTab===t.id?styles.tabActive:''}`}
              onClick={()=>setActiveTab(t.id)}>
              {t.label}
              {t.badge && <span className={styles.tabBadge}>{t.badge}</span>}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className={styles.tabBody}>
          {activeTab==='why' && (
            <div className={styles.tabContent}>
              <ContextPanel context={context} />
              <FundamentalBackdrop
                ticker={ticker}
                isBull={isBull}
                spot={spot}
                fundamentals={fundamentals}
                loading={fundLoading}
              />
              <WhySection
                ticker={ticker}
                sig={sig}
                entry={entry}
                strategy={strategy}
              />
            </div>
          )}
          {activeTab==='manage' && (
            <ManageTab positions={activePositions} price={spot} ticker={ticker} sig={sig} />
          )}
          {activeTab==='naked' && (
            <>
              {!hasPositions && !noTrade && (
                <RecommendedBanner
                  conviction={conviction} isBull={isBull}
                  spot={spot} ticker={ticker}
                  params={params} account={account}
                  entry={entry} />
              )}
              <NakedTab ticker={ticker} spot={spot}
                isBull={isBull} conviction={conviction}
                account={account} params={params}
                ivOverride={ivOverride}
                sig={sig} fundamentals={fundamentals} />
            </>
          )}
          {activeTab==='spread' && (
            <>
              {!hasPositions && !noTrade && (
                <RecommendedBanner
                  conviction={conviction} isBull={isBull}
                  spot={spot} ticker={ticker}
                  params={params} account={account}
                  entry={entry} />
              )}
              <SpreadTab ticker={ticker} spot={spot}
                isBull={isBull} conviction={conviction}
                account={account} params={params}
                ivOverride={ivOverride}
                sig={sig} fundamentals={fundamentals} />
            </>
          )}
          {activeTab==='leap' && (
            <LeapTab ticker={ticker} spot={spot} isBull={isBull}
              sig={sig} fundamentals={fundamentals} />
          )}
        </div>

      </div>
    </div>,
    document.body
  );
}
