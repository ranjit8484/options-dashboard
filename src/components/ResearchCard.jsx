import { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  buildRec, buildLeapRec, getExpiries, getLeapExpiries, getIV
} from '../lib/strikeCalc';
import { loadParams } from '../hooks/useParams';
import { fetchLivePrices } from '../hooks/usePositions';
import { calcStatus, estPnl, f$,
  calcCompositeScore } from '../lib/finance';
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
          <span className={styles.contextLbl}>
            THESIS
          </span>
          <span className={styles.contextVal}>
            {context.thesis.summary}
          </span>
        </div>
      )}
      {context.thesis?.keyRisks?.length > 0 && (
        <div className={styles.contextRow}>
          <span className={styles.contextLbl}>
            RISKS
          </span>
          <span className={styles.contextVal}>
            {context.thesis.keyRisks.join(' · ')}
          </span>
        </div>
      )}
      {context.tradeGuidance?.postEarnings
        ?.ifMiss && (
        <div className={styles.contextRow}>
          <span className={styles.contextLbl}>
            IF MISS
          </span>
          <span className={`${styles.contextVal}
            ${styles.contextGreen}`}>
            {context.tradeGuidance
              .postEarnings.ifMiss}
          </span>
        </div>
      )}
      {context.tradeGuidance?.postEarnings
        ?.ifBeat && (
        <div className={styles.contextRow}>
          <span className={styles.contextLbl}>
            IF BEAT
          </span>
          <span className={styles.contextVal}>
            {context.tradeGuidance
              .postEarnings.ifBeat}
          </span>
        </div>
      )}
      {context.tradeGuidance?.postEarnings
        ?.watchFor && (
        <div className={styles.contextRow}>
          <span className={styles.contextLbl}>
            WATCH
          </span>
          <span className={`${styles.contextVal}
            ${styles.contextAmber}`}>
            {context.tradeGuidance
              .postEarnings.watchFor}
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

// ── Score panel ───────────────────────────────────────────────────
function ScorePanel({ score }) {
  if (!score) return null;

  const colorMap = {
    green: styles.scorePanelGreen,
    amber: styles.scorePanelAmber,
    red:   styles.scorePanelRed,
  };

  const rows = [
    score.earningsFlag && {
      icon: '📅', label: 'EARNINGS',
      val: score.earningsFlag,
      cls: styles.scoreRowRed
    },
    score.rangeFlag && {
      icon: '📊', label: 'RANGE',
      val: score.rangeFlag.msg,
      cls: score.rangeFlag.level === 'BLOCK'
        ? styles.scoreRowRed
        : score.rangeFlag.level === 'WARN'
        ? styles.scoreRowAmber
        : styles.scoreRowGreen
    },
    score.alignFlag && {
      icon: '🎯', label: 'SIGNAL',
      val: score.alignFlag,
      cls: score.breakdown.align >= 22
        ? styles.scoreRowGreen
        : score.breakdown.align >= 15
        ? styles.scoreRowAmber
        : styles.scoreRowRed
    },
    score.maturityFlag && {
      icon: '⏱', label: 'MATURITY',
      val: score.maturityFlag,
      cls: score.breakdown.maturity >= 14
        ? styles.scoreRowGreen
        : score.breakdown.maturity >= 7
        ? styles.scoreRowAmber
        : styles.scoreRowRed
    },
    score.marketFlag && {
      icon: '🌐', label: 'MARKET',
      val: score.marketFlag,
      cls: score.breakdown.market >= 10
        ? styles.scoreRowGreen
        : score.breakdown.market >= 5
        ? styles.scoreRowAmber
        : styles.scoreRowRed
    },
    score.extFlag && {
      icon: '📏', label: 'EXTENSION',
      val: score.extFlag,
      cls: score.breakdown.ext >= 7
        ? styles.scoreRowGreen
        : styles.scoreRowAmber
    },
    score.rsiFlag && {
      icon: '📉', label: 'RSI',
      val: score.rsiFlag,
      cls: styles.scoreRowAmber
    },
    score.macdFlag && {
      icon: '📈', label: 'MACD',
      val: score.macdFlag,
      cls: score.breakdown.macd > 0
        ? styles.scoreRowGreen
        : styles.scoreRowAmber
    },
    score.velocityFlag && {
      icon: '📉', label: 'VELOCITY',
      val: score.velocityFlag,
      cls: styles.scoreRowAmber
    },
  ].filter(Boolean);

  return (
    <div className={`${styles.scorePanel}
      ${colorMap[score.tierColor] ?? ''}`}>

      {/* Primary decision */}
      <div className={styles.scoreTier}>
        <span className={styles.scoreTierLabel}>
          {score.tierLabel}
        </span>
      </div>

      {/* Recommendation */}
      <div className={styles.scoreRec}>
        {score.recommendation}
      </div>

      {/* Watch for */}
      {score.watchFor && (
        <div className={styles.scoreWatch}>
          {score.watchFor}
        </div>
      )}

      {/* Reversal trigger checklist — only on BLOCK tier */}
      {score.tier === 'BLOCK' && score.phase?.phase === 1 && (
        <div className={styles.triggerList}>
          <div className={styles.triggerHeader}>
            Reversal watch — staged entry triggers
          </div>
          {[
            {
              num: 1,
              title: '1H turns bullish',
              desc: '1H xs ≥ 1 AND 1H RSI crosses above 40',
              trade: score.rangePos < 0.3
                ? 'Probe: sell put spread 5% OTM · small size'
                : 'Probe: sell call spread 5% OTM · small size',
              state: 'watch'
            },
            {
              num: 2,
              title: '4H confirms',
              desc: '4H xs ≥ 1 AND price closes above D Kijun',
              trade: 'Entry: normal size spread · 14-21 DTE',
              state: 'wait'
            },
            {
              num: 3,
              title: 'D turns',
              desc: 'D xs ≥ 1 AND W signal resets',
              trade: 'Add size or LEAP if already in from trigger 1/2',
              state: 'wait'
            },
          ].map((t, i) => (
            <div key={i} className={`${styles.triggerItem} ${styles[`trigger_${t.state}`]}`}>
              <span className={`${styles.triggerNum} ${styles[`triggerNum_${t.state}`]}`}>
                {t.num}
              </span>
              <div className={styles.triggerText}>
                <div className={styles.triggerTitle}>{t.title}</div>
                <div className={styles.triggerDesc}>{t.desc}</div>
                <div className={styles.triggerTrade}>{t.trade}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Score breakdown rows */}
      <div className={styles.scoreRows}>
        {rows.map((row, i) => (
          <div key={i}
            className={`${styles.scoreRow} ${row.cls}`}>
            <span className={styles.scoreRowIcon}>
              {row.icon}
            </span>
            <span className={styles.scoreRowLabel}>
              {row.label}
            </span>
            <span className={styles.scoreRowVal}>
              {row.val}
            </span>
          </div>
        ))}
      </div>

      {/* Score breakdown bar */}
      <div className={styles.scoreBar}>
        <div
          className={`${styles.scoreBarFill}
            ${score.tierColor === 'green'
              ? styles.scoreBarGreen
              : score.tierColor === 'amber'
              ? styles.scoreBarAmber
              : styles.scoreBarRed}`}
          style={{ width: `${score.score}%` }}
        />
      </div>
    </div>
  );
}

// ── Fundamental backdrop ──────────────────────────────────────────
function FundamentalBackdrop({
  ticker, isBull, spot, fundamentals, loading
}) {
  if (loading) return (
    <div className={styles.bdLoading}>
      Loading fundamentals...
    </div>
  );
  if (!fundamentals) return null;

  const bd = calcBackdrop(fundamentals,
    isBull, spot);
  if (!bd) return null;

  const range52 = fundamentals.range52;
  const rangePos = range52 && spot
    ? Math.max(0, Math.min(1,
        (spot - range52.low)
        / (range52.high - range52.low)
      ))
    : null;

  const rangePct = rangePos !== null
    ? Math.round(rangePos * 100) : null;

  const ratingCls = {
    STRONG:   styles.bdStrong,
    SUPPORTS: styles.bdSupports,
    NEUTRAL:  styles.bdNeutral,
    CAUTION:  styles.bdCaution,
    AGAINST:  styles.bdAgainst,
  }[bd.rating] ?? styles.bdNeutral;

  const ratingLabel = {
    STRONG:   'Strong for ' + (isBull
      ? 'bullish' : 'bearish'),
    SUPPORTS: 'Supports ' + (isBull
      ? 'bullish' : 'bearish'),
    NEUTRAL:  'Neutral',
    CAUTION:  'Caution',
    AGAINST:  'Against ' + (isBull
      ? 'bullish' : 'bearish'),
  }[bd.rating] ?? 'Neutral';

  return (
    <div className={styles.bdPanel}>

      {/* 52-week range bar — top */}
      {range52 && rangePct !== null && (
        <div className={styles.bdRangeBlock}>
          <div className={styles.bdRangeLabels}>
            <span className={styles.bdRangeLow}>
              ${Math.round(range52.low)
                .toLocaleString()}
            </span>
            <span className={styles.bdRangePct}>
              {rangePct}% of range
            </span>
            <span className={styles.bdRangeHigh}>
              ${Math.round(range52.high)
                .toLocaleString()}
            </span>
          </div>
          <div className={styles.bdRangeBar}>
            <div
              className={styles.bdRangeFill}
              style={{ width: `${rangePct}%` }}
            />
            <div
              className={styles.bdRangePointer}
              style={{ left: `${rangePct}%` }}
            />
          </div>
          <div className={styles.bdRangeNote}>
            {rangePct >= 80
              ? 'Near yearly high — limited upside'
              : rangePct >= 60
              ? 'Upper half — extended'
              : rangePct >= 40
              ? 'Mid range — neutral'
              : rangePct >= 20
              ? 'Lower half — potential value'
              : 'Near yearly low — limited downside'}
          </div>
        </div>
      )}

      <div className={styles.bdHeader}>
        <span className={styles.bdTitle}>
          FUNDAMENTALS
        </span>
        <span className={`${styles.bdRating}
          ${ratingCls}`}>
          {ratingLabel}
        </span>
      </div>

      {/* Earnings warning */}
      {fundamentals.nextEarnings && (
        <div className={`${styles.bdEarnings}
          ${fundamentals.nextEarnings.dte <= 7
            ? styles.bdEarningsRed
            : styles.bdEarningsAmber}`}>
          Earnings {fundamentals.nextEarnings.label}
          · {fundamentals.nextEarnings.dte}d away
          {fundamentals.nextEarnings.dte <= 7
            ? ' — avoid new positions'
            : ' — elevated IV'}
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
function TradeRecommendationTab({
  ticker, spot, isBull, conviction,
  account, params, ivOverride, sig,
  fundamentals, compositeScore, earningsDte,
  isCounterTrend, rangePos
}) {
  const isCall = !isBull;
  const iv = ivOverride / 100;

  // Best expiry — prefer 14-21 DTE
  const expiries = getExpiries(2, 5);
  const bestExp = expiries.find(e =>
    e.dte >= 14 && e.dte <= 28
  ) ?? expiries[0];

  // Compute best spread rec
  const shortDelta = conviction === 'full' ? 0.30
    : conviction === 'high' ? 0.28 : 0.25;
  const longDelta = shortDelta * 0.45;

  const spreadRec = bestExp ? buildRec({
    spot, ticker, isCall,
    shortDelta, longDelta: longDelta,
    dte: bestExp.dte, tradeType: 'spread',
    account, conviction, params, ivOverride: iv
  }) : null;

  // Compute naked rec
  const nakedRec = bestExp ? buildRec({
    spot, ticker, isCall,
    shortDelta: conviction === 'full' ? 0.25 : 0.20,
    longDelta: null,
    dte: bestExp.dte, tradeType: 'naked',
    account, conviction, params, ivOverride: iv
  }) : null;

  // Compute LEAP rec
  const leapExpiries = getExpiries(6, 18);
  const leapExp = leapExpiries.find(e => e.dte >= 180)
    ?? leapExpiries[leapExpiries.length - 1];
  const leapRec = leapExp ? buildRec({
    spot, ticker, isCall: !isBull,
    shortDelta: 0.40, longDelta: null,
    dte: leapExp?.dte ?? 365,
    tradeType: 'naked',
    account, conviction, params, ivOverride: iv
  }) : null;

  // Decide best fit based on conviction
  const bestFit = conviction === 'full'
    ? 'naked' : 'spread';

  const score = compositeScore?.score ?? 0;

  return (
    <div className={styles.tabContent}>

      {/* Counter-trend banner */}
      {isCounterTrend && (
        <div className={styles.counterTrendBanner}>
          <div className={styles.counterTrendBannerTitle}>
            ↩ Counter-trend setup
          </div>
          <div className={styles.counterTrendBannerDesc}>
            {isBull
              ? `Bull signal exhausted at ${Math.round(rangePos*100)}% of range — selling calls is the play, not buying. Use the Bear Call Spread below.`
              : `Bear signal exhausted at ${Math.round(rangePos*100)}% of range — selling puts is the play, not shorting. Use the Bull Put Spread below.`
            }
          </div>
          <div className={styles.counterTrendBannerRules}>
            ⚠ Half normal size · Hard stop if W signal reverses · Do not hold through earnings
          </div>
        </div>
      )}

      {/* Earnings window guidance */}
      {earningsDte <= 14 && earningsDte > 2 && (
        <div className={styles.earningsBanner}>
          <div className={styles.earningsBannerTitle}>
            📅 Earnings in {earningsDte}d — two strategies available
          </div>
          <div className={styles.earningsOptA}>
            <div className={styles.earningsOptLabel}>
              Option A — Pre-earnings IV harvest
              <span className={styles.earningsOptTag}>Close before earnings</span>
            </div>
            <div className={styles.earningsOptDesc}>
              Enter spread now, collect elevated IV premium, close 1 day before announcement.
              Never take the binary gap risk — close regardless of P&L.
            </div>
          </div>
          <div className={styles.earningsOptB}>
            <div className={styles.earningsOptLabel}>
              Option B — Post-earnings direction play
              <span className={styles.earningsOptTag}>Wait for gap</span>
            </div>
            <div className={styles.earningsOptDesc}>
              Wait for earnings reaction. Enter 1-2 days after gap settles.
              Only enter if signal direction confirmed by the gap.
            </div>
          </div>
        </div>
      )}

      {/* Best fit */}
      <div className={styles.tradeSection}>
        <div className={styles.tradeSectionLabel}>
          BEST FIT
        </div>

        {bestFit === 'spread' && spreadRec ? (
          <div className={`${styles.tradeRec}
            ${styles.tradeRecFeatured}`}>
            <div className={styles.tradeRecHead}>
              <span className={styles.tradeRecName}>
                {isBull ? 'Put spread' : 'Call spread'}
              </span>
              <span className={`${styles.tradeRecTag}
                ${styles.tradeTagGreen}`}>
                Recommended
              </span>
            </div>
            <div className={styles.tradeRecBody}>
              <div className={styles.tradeStrikes}>
                Sell ${spreadRec.shortStrike}
                {spreadRec.longStrike
                  ? ` / Buy $${spreadRec.longStrike}`
                  : ''} {isCall ? 'call' : 'put'}
              </div>
              <div className={styles.tradeMetaGrid}>
                <span className={styles.tradeMeta}>
                  Expiry
                </span>
                <span className={styles.tradeMetaVal}>
                  {bestExp?.label} · {bestExp?.dte}d
                </span>
                <span className={styles.tradeMeta}>
                  Premium
                </span>
                <span className={styles.tradeMetaVal}>
                  ~${spreadRec.premium}/share
                </span>
                <span className={styles.tradeMeta}>
                  Buffer
                </span>
                <span className={styles.tradeMetaVal}>
                  {parseFloat(spreadRec.buffer ?? 0).toFixed(1)}% OTM
                </span>
                <span className={styles.tradeMeta}>
                  Max gain/loss
                </span>
                <span className={styles.tradeMetaVal}>
                  <span className={styles.pos}>
                    +${spreadRec.premiumTotal}
                  </span>
                  {' / '}
                  <span className={styles.neg}>
                    -${spreadRec.maxLoss
                      ?.toLocaleString() ?? '—'}
                  </span>
                </span>
              </div>
              <div className={styles.tradeWhy}>
                {conviction === 'medium' || conviction === 'low'
                  ? `Medium conviction — defined risk appropriate. Need W★★+D★★ for naked.`
                  : `High conviction — spread gives defined risk with strong premium.`}
              </div>
            </div>
          </div>
        ) : bestFit === 'naked' && nakedRec ? (
          <div className={`${styles.tradeRec}
            ${styles.tradeRecFeatured}`}>
            <div className={styles.tradeRecHead}>
              <span className={styles.tradeRecName}>
                {isBull ? 'Naked put' : 'Naked call'}
              </span>
              <span className={`${styles.tradeRecTag}
                ${styles.tradeTagGreen}`}>
                Recommended
              </span>
            </div>
            <div className={styles.tradeRecBody}>
              <div className={styles.tradeStrikes}>
                Sell ${nakedRec.shortStrike}
                {isCall ? ' call' : ' put'}
              </div>
              <div className={styles.tradeMetaGrid}>
                <span className={styles.tradeMeta}>
                  Expiry
                </span>
                <span className={styles.tradeMetaVal}>
                  {bestExp?.label} · {bestExp?.dte}d
                </span>
                <span className={styles.tradeMeta}>
                  Premium
                </span>
                <span className={styles.tradeMetaVal}>
                  ~${nakedRec.premium}/share
                </span>
                <span className={styles.tradeMeta}>
                  Buffer
                </span>
                <span className={styles.tradeMetaVal}>
                  {parseFloat(nakedRec.buffer ?? 0).toFixed(1)}% OTM
                </span>
                <span className={styles.tradeMeta}>
                  Collateral
                </span>
                <span className={styles.tradeMetaVal}>
                  ~${nakedRec.margin
                    ?.toLocaleString() ?? '—'}
                </span>
              </div>
              <div className={styles.tradeWhy}>
                Full conviction W★★+D★★ — naked appropriate.
                Fresh signal, strong setup.
              </div>
            </div>
          </div>
        ) : (
          <div className={styles.noRecs}>
            No valid strikes — adjust IV above
          </div>
        )}
      </div>

      {/* Also consider */}
      <div className={styles.tradeSection}>
        <div className={styles.tradeSectionLabel}>
          ALSO CONSIDER
        </div>

        {/* Spread alternative (when naked is best) */}
        {bestFit === 'naked' && spreadRec && (
          <div className={styles.tradeRec}>
            <div className={styles.tradeRecHead}>
              <span className={styles.tradeRecName}>
                {isBull ? 'Put spread' : 'Call spread'}
              </span>
              <span className={`${styles.tradeRecTag}
                ${styles.tradeTagGrey}`}>
                Defined risk
              </span>
            </div>
            <div className={styles.tradeRecBody}>
              <div className={styles.tradeStrikes}>
                Sell ${spreadRec.shortStrike}
                {spreadRec.longStrike
                  ? ` / Buy $${spreadRec.longStrike}`
                  : ''} {isCall ? 'call' : 'put'}
              </div>
              <div className={styles.tradeMetaGrid}>
                <span className={styles.tradeMeta}>
                  Premium
                </span>
                <span className={styles.tradeMetaVal}>
                  ~${spreadRec.premium}/share
                </span>
                <span className={styles.tradeMeta}>
                  Max loss
                </span>
                <span className={styles.tradeMetaVal}>
                  -${spreadRec.maxLoss
                    ?.toLocaleString() ?? '—'}
                </span>
              </div>
              <div className={styles.tradeWhy}>
                If you prefer capped risk. Lower premium
                but no margin requirement.
              </div>
            </div>
          </div>
        )}

        {/* Naked alternative (when spread is best) */}
        {bestFit === 'spread' && nakedRec && (
          <div className={styles.tradeRec}>
            <div className={styles.tradeRecHead}>
              <span className={styles.tradeRecName}>
                {isBull ? 'Naked put' : 'Naked call'}
              </span>
              <span className={`${styles.tradeRecTag}
                ${styles.tradeTagAmber}`}>
                Higher risk
              </span>
            </div>
            <div className={styles.tradeRecBody}>
              <div className={styles.tradeStrikes}>
                Sell ${nakedRec.shortStrike}
                {isCall ? ' call' : ' put'}
              </div>
              <div className={styles.tradeMetaGrid}>
                <span className={styles.tradeMeta}>
                  Premium
                </span>
                <span className={styles.tradeMetaVal}>
                  ~${nakedRec.premium}/share
                </span>
                <span className={styles.tradeMeta}>
                  Collateral
                </span>
                <span className={styles.tradeMetaVal}>
                  ~${nakedRec.margin
                    ?.toLocaleString() ?? '—'}
                </span>
              </div>
              <div className={styles.tradeWhy}>
                Only if W★★+D★★ confirmed. Current
                conviction is {conviction} — spread safer.
              </div>
            </div>
          </div>
        )}

        {/* LEAP always shown as alternative */}
        {leapRec && leapExp && (
          <div className={styles.tradeRec}>
            <div className={styles.tradeRecHead}>
              <span className={styles.tradeRecName}>
                {isBull ? 'Call LEAP' : 'Put LEAP'}
              </span>
              <span className={`${styles.tradeRecTag}
                ${styles.tradeTagGrey}`}>
                Long-term
              </span>
            </div>
            <div className={styles.tradeRecBody}>
              <div className={styles.tradeStrikes}>
                Buy ${leapRec.shortStrike}
                {isBull ? ' call' : ' put'}
                · {leapExp.label}
              </div>
              <div className={styles.tradeMetaGrid}>
                <span className={styles.tradeMeta}>
                  Cost
                </span>
                <span className={styles.tradeMetaVal}>
                  ~${leapRec.premium}/share
                  = ${leapRec.premiumTotal} total
                </span>
                <span className={styles.tradeMeta}>
                  Break even
                </span>
                <span className={styles.tradeMetaVal}>
                  ${isBull
                    ? Math.round(
                        (leapRec.shortStrike ?? 0)
                        + parseFloat(leapRec.premium ?? 0)
                      )
                    : Math.round(
                        (leapRec.shortStrike ?? 0)
                        - parseFloat(leapRec.premium ?? 0)
                      )
                  }
                </span>
              </div>
              <div className={styles.tradeWhy}>
                For 6-month directional conviction.
                Needs bigger move but unlimited upside.
              </div>
            </div>
          </div>
        )}
      </div>

      <div className={styles.exitRule}>
        Exit: close at 50% profit or 7 DTE ·
        Roll if breached with 5+ DTE remaining
      </div>
    </div>
  );
}

function ProbeTab({ ticker, spot, isBull, sig, compositeScore }) {
  const phase = compositeScore?.phase;
  const h1Xs  = sig?.['1H']?.xs ?? 0;
  const h4Xs  = sig?.['4H']?.xs ?? 0;
  const dXs   = sig?.D?.xs ?? 0;
  const dKijun = sig?.D?.kijun ?? 0;

  const trigger1Done = isBull ? h1Xs >= 1 : h1Xs <= -1;
  const trigger2Done = isBull ? h4Xs >= 1 : h4Xs <= -1;
  const trigger3Done = isBull ? dXs  >= 1 : dXs  <= -1;

  const spreadType = isBull ? 'put credit spread' : 'call credit spread';
  const probeStrike = spot
    ? (isBull
        ? `$${Math.round(spot * 0.92)}/$${Math.round(spot * 0.87)}`
        : `$${Math.round(spot * 1.08)}/$${Math.round(spot * 1.13)}`)
    : '—';

  const triggers = [
    {
      num: 1,
      title: isBull ? '1H turns bullish' : '1H turns bearish',
      desc: isBull
        ? '1H xs ≥ 1 AND 1H RSI crosses above 40'
        : '1H xs ≤ -1 AND 1H RSI crosses below 60',
      trade: `Probe: sell ${probeStrike} ${spreadType} · 14 DTE · 1 contract max`,
      state: trigger1Done ? 'done' : 'watch',
    },
    {
      num: 2,
      title: isBull ? '4H confirms bullish' : '4H confirms bearish',
      desc: isBull
        ? `4H xs ≥ 1 AND price closes above D Kijun ($${Math.round(dKijun)})`
        : `4H xs ≤ -1 AND price closes below D Kijun ($${Math.round(dKijun)})`,
      trade: `Entry: normal size ${spreadType} · 14-21 DTE`,
      state: trigger2Done ? 'done' : trigger1Done ? 'watch' : 'wait',
    },
    {
      num: 3,
      title: isBull ? 'D turns bullish' : 'D turns bearish',
      desc: 'Full reversal confirmed — D signal flips direction',
      trade: 'Add size · consider LEAP if already in from trigger 1/2',
      state: trigger3Done ? 'done' : trigger2Done ? 'watch' : 'wait',
    },
  ];

  const stateIcon  = { done:'✓', watch:'→', wait:'○' };
  const stateCls   = {
    done:  styles.triggerDone,
    watch: styles.triggerWatch,
    wait:  styles.triggerWait,
  };
  const stateNumCls = {
    done:  styles.triggerNumDone,
    watch: styles.triggerNumWatch,
    wait:  styles.triggerNumWait,
  };

  return (
    <div className={styles.tabContent}>
      <div className={styles.probeBanner}>
        <div className={styles.probeBannerTitle}>
          🔵 Testing waters — {isBull ? 'bear exhausted' : 'bull exhausted'}, watching for reversal
        </div>
        <div className={styles.probeBannerDesc}>
          {phase?.reason ?? 'Move largely done. Small probe trade only — defined risk, opposite direction.'}
          {' '}Max loss $150-200 per contract.
        </div>
      </div>

      <div className={styles.triggerListWrap}>
        <div className={styles.triggerListLabel}>
          Staged entry triggers — act when each fires
        </div>
        {triggers.map((t, i) => (
          <div key={i} className={`${styles.triggerItem} ${stateCls[t.state]}`}>
            <span className={`${styles.triggerNum} ${stateNumCls[t.state]}`}>
              {stateIcon[t.state]}
            </span>
            <div className={styles.triggerText}>
              <div className={styles.triggerTitle}>
                {t.title}
                {t.state === 'done' && (
                  <span className={styles.triggerFired}> — FIRED</span>
                )}
                {t.state === 'watch' && (
                  <span className={styles.triggerWatching}> — watching now</span>
                )}
              </div>
              <div className={styles.triggerDesc}>{t.desc}</div>
              <div className={styles.triggerTrade}>{t.trade}</div>
            </div>
          </div>
        ))}
      </div>

      <div className={styles.exitRule}>
        Probe trades: close at 50% profit · max 1 contract · hard stop at 7 DTE
      </div>
    </div>
  );
}

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

          // ── Protect the main engine ──────────────────
          // Check if LEAP is working well — if so, be
          // conservative or skip to protect the move
          const leapStrike  = leap.k ?? 0;
          const leapITM     = isCallLeap
            ? price - leapStrike   // positive = ITM for call
            : leapStrike - price;  // positive = ITM for put
          const leapITMPct  = leapStrike > 0
            ? (leapITM / leapStrike * 100) : 0;
          const leapDeepITM = leapITMPct > 20;
          const leapModITM  = leapITMPct > 5 && leapITMPct <= 20;

          // Earnings check from fundamentals
          const earningsDte = fundamentals?.nextEarnings?.dte ?? 999;
          const earningsClose = earningsDte <= 14;

          // Suggested strike calculation
          // Aggressive: 5% OTM from current price
          // Moderate: 10% OTM
          // Conservative: 15% OTM
          const getStrike = (pct) => {
            if (!price) return null;
            const raw = isCallLeap
              ? price * (1 + pct / 100)
              : price * (1 - pct / 100);
            return Math.round(raw / 5) * 5; // round to nearest $5
          };

          // Expiry: prefer 14-21 DTE
          const expiries = getExpiries(2, 4);
          const bestExp = expiries.find(e => e.dte >= 14 && e.dte <= 21)
            ?? expiries[0];

          let signal, signalCls, action, detail, suggestedStrike, skipReason;

          if (earningsClose) {
            signal      = '⏸ PAUSE — Earnings Soon';
            signalCls   = styles.harvestSkip;
            action      = `Earnings in ${earningsDte}d — do not open new harvest`;
            detail      = 'Binary event risk could gap through your short strike. Wait until after earnings to harvest.';
            skipReason  = 'earnings';
          } else if (bigMove) {
            signal      = '🚫 SKIP HARVEST';
            signalCls   = styles.harvestSkip;
            action      = isCallLeap
              ? 'Strong bull signal — let LEAP run'
              : 'Strong bear signal — let LEAP run';
            detail      = 'W+D strongly aligned with your LEAP direction. Do not sell premium — you will cap your profit on the main move.';
            skipReason  = 'bigmove';
          } else if (leapDeepITM) {
            signal      = '◐ CONSERVATIVE — LEAP Working';
            signalCls   = styles.harvestCon;
            action      = isCallLeap
              ? 'LEAP is deep ITM — sell far OTM call only'
              : 'LEAP is deep ITM — sell far OTM put only';
            detail      = `LEAP is ${leapITMPct.toFixed(0)}% ITM — protect the profit. Stay 15%+ OTM on harvest.`;
            suggestedStrike = getStrike(15);
          } else if (opposing) {
            signal      = '⚡ AGGRESSIVE HARVEST';
            signalCls   = styles.harvestAgg;
            action      = isCallLeap
              ? 'Short-term bearish — sell call closer to money'
              : 'Short-term bullish — sell put closer to money';
            detail      = '4H/1H opposing LEAP — elevated premium available. LEAP not yet ITM so harvest is safe.';
            suggestedStrike = getStrike(5);
          } else if (leapModITM || aligned) {
            signal      = '◐ CONSERVATIVE HARVEST';
            signalCls   = styles.harvestCon;
            action      = isCallLeap
              ? 'Sell far OTM call — protect upside'
              : 'Sell far OTM put — protect downside';
            detail      = leapModITM
              ? `LEAP is ${leapITMPct.toFixed(0)}% ITM — stay conservative, protect the move.`
              : '4H/1H aligned with LEAP — stay far OTM to avoid capping gains.';
            suggestedStrike = getStrike(12);
          } else {
            signal      = '○ MODERATE HARVEST';
            signalCls   = styles.harvestMod;
            action      = isCallLeap
              ? 'Sell 25-delta call, 2-3 weeks out'
              : 'Sell 25-delta put, 2-3 weeks out';
            detail      = 'Neutral short-term — standard harvest cycle. 10% OTM gives good premium with safety buffer.';
            suggestedStrike = getStrike(10);
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
              {/* Suggested trade */}
              {!skipReason && suggestedStrike && !activeHedge && bestExp && (
                <div className={styles.harvestSuggested}>
                  <span className={styles.harvestSuggestedLabel}>
                    Suggested:
                  </span>
                  <span className={styles.harvestSuggestedTrade}>
                    Sell ${suggestedStrike} {isCallLeap ? 'call' : 'put'}
                    · {bestExp.label} · {bestExp.dte}d
                  </span>
                  <span className={styles.harvestSuggestedBuffer}>
                    {price && suggestedStrike
                      ? `${Math.abs(((suggestedStrike - price) / price * 100)).toFixed(1)}% buffer`
                      : ''}
                  </span>
                </div>
              )}
              {activeHedge ? (
                <div className={styles.harvestActive}>
                  ✓ Active: {activeHedge.lbl} · {activeHedge.exp} · {activeHedge.dte}d left
                </div>
              ) : skipReason ? null : (
                <div className={styles.harvestMissing}>
                  ⚠ No harvest open — sell a short {isCallLeap ? 'call' : 'put'} against this LEAP now
                </div>
              )}
            </div>
          );
        });
      })()}

      {/* ── Existing position rows (unchanged) ── */}
      {positions.map((p, i) => {
        const { status, be, diff } = calcStatus(p.dir, p.k, p.prem, price);
        const pnl = estPnl(ticker, p.dir, p.k, p.dte??0, p.prem, p.qty, price,
          p.isSpread, p.longK, p.spreadWidth);
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
              <Metric label="Est P&L"
                val={<>{pnl>=0?'+':'-'}${Math.round(Math.abs(pnl)).toLocaleString()}<span className={styles.pnlTheoretical}> est.</span></>}
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

// ── Counter-Trend Tab ─────────────────────────────────────────────
function CounterTrendTab({
  ticker, spot, isBull, rangePos, sig,
  compositeScore, ivOverride, account, params, earningsDte
}) {
  const iv = (ivOverride ?? 30) / 100;

  // Counter direction is opposite of main signal
  // Bull exhausted at highs → sell call spread
  // Bear exhausted at lows → sell put spread
  const isSellingCalls = isBull; // selling calls against bull exhaustion
  const optType = isSellingCalls ? 'Call' : 'Put';

  // Suggested strikes
  // Short strike: 5-8% OTM from current price
  // Long strike: 10-15% OTM (protection)
  const shortStrikePct = isSellingCalls ? 1.06 : 0.94;
  const longStrikePct  = isSellingCalls ? 1.12 : 0.88;
  const shortStrike = spot
    ? Math.round(spot * shortStrikePct / 5) * 5 : null;
  const longStrike  = spot
    ? Math.round(spot * longStrikePct  / 5) * 5 : null;
  const spreadWidth = shortStrike && longStrike
    ? Math.abs(longStrike - shortStrike) : null;

  // Estimated premium (rough Black-Scholes approximation)
  // Using 30 DTE as standard
  const dte = 30;
  const estPrem = spot && iv && shortStrike
    ? Math.round(spot * iv * Math.sqrt(dte / 365) * 0.15 * 100) / 100
    : null;
  const maxGain = estPrem ? Math.round(estPrem * 100) : null;
  const maxLoss = spreadWidth && estPrem
    ? Math.round((spreadWidth - estPrem) * 100) : null;

  // Buffer to short strike
  const buffer = spot && shortStrike
    ? Math.abs(((shortStrike - spot) / spot) * 100).toFixed(1)
    : null;

  // Signal context
  const wSince = sig?.W?.since ?? 0;
  const rangePosPct = rangePos !== null
    ? Math.round(rangePos * 100) : null;

  return (
    <div className={styles.counterTab}>
      {/* Header warning */}
      <div className={styles.counterHeader}>
        <span className={styles.counterIcon}>↩</span>
        <div>
          <div className={styles.counterTitle}>
            Counter-trend {optType} Spread
          </div>
          <div className={styles.counterSub}>
            {isSellingCalls
              ? 'Bull signal exhausted at highs — sell calls into the resistance'
              : 'Bear signal exhausted at lows — sell puts into the support'}
          </div>
        </div>
      </div>

      {/* Why this works */}
      <div className={styles.counterReason}>
        <div className={styles.counterReasonRow}>
          <span className={styles.counterReasonIcon}>📍</span>
          <span>Price at {rangePosPct}% of 52wk range
            — {isSellingCalls ? 'near highs, limited upside' : 'near lows, limited downside'}
          </span>
        </div>
        <div className={styles.counterReasonRow}>
          <span className={styles.counterReasonIcon}>⏱</span>
          <span>W signal {wSince} candles old
            — trend exhaustion likely, momentum fading
          </span>
        </div>
        <div className={styles.counterReasonRow}>
          <span className={styles.counterReasonIcon}>⚠</span>
          <span>This is a counter-trend trade — use smaller size,
            tighter stops than normal
          </span>
        </div>
        {earningsDte <= 30 && (
          <div className={styles.counterReasonRow}>
            <span className={styles.counterReasonIcon}>📅</span>
            <span style={{color:'var(--amber)'}}>
              Earnings in {earningsDte}d — consider waiting or
              use wider spread for protection
            </span>
          </div>
        )}
      </div>

      {/* Suggested trade */}
      {shortStrike && longStrike && (
        <div className={styles.counterTrade}>
          <div className={styles.counterTradeTitle}>Suggested Trade</div>
          <div className={styles.counterTradeRow}>
            <span className={styles.counterTradeLabel}>Structure</span>
            <span className={styles.counterTradeVal}>
              {isSellingCalls ? 'Bear' : 'Bull'} {optType} Spread
            </span>
          </div>
          <div className={styles.counterTradeRow}>
            <span className={styles.counterTradeLabel}>Sell</span>
            <span className={styles.counterTradeVal}>
              ${shortStrike} {optType} · {buffer}% OTM
            </span>
          </div>
          <div className={styles.counterTradeRow}>
            <span className={styles.counterTradeLabel}>Buy</span>
            <span className={styles.counterTradeVal}>
              ${longStrike} {optType} · protection
            </span>
          </div>
          <div className={styles.counterTradeRow}>
            <span className={styles.counterTradeLabel}>Width</span>
            <span className={styles.counterTradeVal}>
              ${spreadWidth} spread
            </span>
          </div>
          {estPrem && (
            <div className={styles.counterTradeRow}>
              <span className={styles.counterTradeLabel}>Est. Premium</span>
              <span className={`${styles.counterTradeVal} ${styles.pos}`}>
                ~${estPrem} · max gain ${maxGain}
              </span>
            </div>
          )}
          {maxLoss && (
            <div className={styles.counterTradeRow}>
              <span className={styles.counterTradeLabel}>Max Loss</span>
              <span className={`${styles.counterTradeVal} ${styles.neg}`}>
                ${maxLoss} (defined risk)
              </span>
            </div>
          )}
          <div className={styles.counterTradeRow}>
            <span className={styles.counterTradeLabel}>Exit rule</span>
            <span className={styles.counterTradeVal}>
              Close at 50% profit · Stop if price breaks {isSellingCalls
                ? `above $${shortStrike}`
                : `below $${shortStrike}`} on daily close
            </span>
          </div>
        </div>
      )}

      {/* Risk warning */}
      <div className={styles.counterWarning}>
        ⚠ Counter-trend trades fail if the trend resumes.
        Use half normal size. Do not hold through earnings.
        Exit immediately if {isSellingCalls ? 'W turns bullish again' : 'W turns bearish again'}.
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────
export function ResearchCard({
  ticker, spot: spotProp, sig, onClose,
  activePositions, balances, allSignals,
  initialTab
}) {
  const params  = loadParams();
  const account = (balances?.rh??0) + (balances?.fid??0);
  const { data: fundamentals, loading: fundLoading } = useFundamentals(ticker);
  const { data: context } = useContext(ticker);

  const defaultIv = Math.round(getIV(ticker) * 100);
  const [ivOverride, setIvOverride] = useState(defaultIv);
  const [liveSpot, setLiveSpot] = useState(null);

  useEffect(() => {
    if (!spotProp && ticker) {
      fetchLivePrices([ticker]).then(result => {
        if (result[ticker]) setLiveSpot(result[ticker]);
      });
    }
  }, [ticker, spotProp]);

  if (!sig) return null;

  const spot = spotProp
    || liveSpot
    || activePositions?.[0]?.k
    || null;

  // Composite score — needs all signals
  // QQQ market filter added in next enhancement
  const compositeScore = useMemo(() => {
    if (!sig || !spot) return null;
    return calcCompositeScore({
      sig,
      fundamentals,
      spot,
      marketSig: ticker !== 'QQQ' ? (allSignals?.['QQQ'] ?? null) : null
    });
  }, [sig, fundamentals, spot]);

  const entry      = sig._entry;
  const strategy   = sig._strategy;
  const conviction = strategy?.conviction ?? 'medium';
  const thesis     = strategy?.thesis ?? '—';

  const isBull = (entry?.action==='SELL'&&entry?.dir==='put')
    ||(entry?.action==='ENTER'&&entry?.dir==='long')
    ||(entry?.action==='WATCH'&&entry?.dir==='long');

  const hasPositions = activePositions?.length > 0;
  const scoreTier = compositeScore?.tier;
  const phase = compositeScore?.phase;
  const earningsDte = fundamentals?.nextEarnings?.dte ?? 999;

  // Tab visibility logic
  const isHardBlock = scoreTier === 'BLOCK'
    && earningsDte <= 2;
  const isEarningsWindow = earningsDte > 2 && earningsDte <= 14;
  const isProbe = (scoreTier === 'BLOCK' || scoreTier === 'AVOID')
    && earningsDte > 2
    && (phase?.phase === 1 || phase?.probeAllowed === true);
  const tradeAllowed = !isHardBlock
    && !isProbe
    && (scoreTier === 'PRIME'
      || scoreTier === 'GOOD'
      || scoreTier === 'MARGINAL'
      || isCounterTrend);

  // Counter-trend: BLOCK at range extreme = opposite direction trade valid
  const rangePos = compositeScore?.rangePos ?? null;
  const isCounterTrend = scoreTier === 'BLOCK'
    && earningsDte > 2
    && rangePos !== null
    && (
      (isBull  && rangePos > 0.80)  // bull exhausted at highs → sell calls
      || (!isBull && rangePos < 0.20) // bear exhausted at lows → sell puts
    );
  const counterTrendDir = isBull ? 'bear' : 'bull';

  const defaultTab = initialTab ?? 'why';
  const [activeTab, setActiveTab] = useState(defaultTab);

  const tabs = [
    { id:'why', label:'📋 Thesis' },
    ...(isProbe
      ? [{ id:'probe', label:'🔵 Probe trade' }]
      : []),
    ...(tradeAllowed
      ? [{ id:'trade', label: isEarningsWindow ? '📅 Trade + earnings' : '💡 Trade' }]
      : []),
    ...(hasPositions
      ? [{ id:'manage', label:`⚡ Manage (${activePositions.length})` }]
      : []),
  ];

  return createPortal(
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.card} onClick={e=>e.stopPropagation()}>

        {/* Header */}
        <div className={styles.cardHeader}>
          <div className={styles.cardHeaderLeft}>
            <span className={styles.cardTicker}>{ticker}</span>
            {/* Direction + fundamentals combined pill */}
            {(() => {
              const bd = fundamentals
                ? calcBackdrop(fundamentals, isBull, spot)
                : null;
              const dirLabel = isBull ? '↑ Bull' : '↓ Bear';
              const dirCls   = isBull ? styles.hdrPillBull : styles.hdrPillBear;
              const fundAgrees = bd && (
                (isBull  && (bd.rating === 'STRONG' || bd.rating === 'SUPPORTS')) ||
                (!isBull && (bd.rating === 'STRONG' || bd.rating === 'SUPPORTS'))
              );
              const fundOpposes = bd && bd.rating === 'AGAINST';
              const combined = fundAgrees
                ? `${dirLabel} — confirmed`
                : fundOpposes
                ? `${dirLabel} — conflicted ⚠`
                : dirLabel;
              return (
                <span className={`${styles.hdrPill} ${dirCls} ${fundOpposes ? styles.hdrPillConflict : ''}`}>
                  {combined}
                </span>
              );
            })()}
            {/* Conviction pill */}
            <span className={`${styles.hdrPill} ${styles.hdrPillConviction} ${styles[`conv_${conviction}`]}`}>
              🎯 {CONVICTION_LABELS[conviction] ?? conviction} conviction
            </span>
            {/* Phase pill */}
            {compositeScore?.phase && compositeScore.phase.phase > 0 && (
              <span className={`${styles.hdrPill} ${styles.hdrPillPhase}`}>
                {compositeScore.phase.emoji} {compositeScore.phase.label}
              </span>
            )}
            {/* Active position pill */}
            {hasPositions && (
              <span className={`${styles.hdrPill} ${styles.hdrPillActive}`}>
                ● Active position
              </span>
            )}
          </div>
          <div className={styles.cardHeaderRight}>
            {compositeScore && (
              <div className={`${styles.scoreBadge} ${
                compositeScore.tierColor === 'green' ? styles.scoreBadgeGreen
                : compositeScore.tierColor === 'amber' ? styles.scoreBadgeAmber
                : styles.scoreBadgeRed
              }`}>
                <span className={styles.scoreBadgeNum}>
                  {compositeScore.score}
                </span>
                <span className={styles.scoreBadgeDen}>/100</span>
              </div>
            )}
            <span className={styles.cardPrice}>
              {spot ? `$${spot.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}` : '—'}
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
              {/* Signal chips row */}
              <div className={styles.sigChipsRow}>
                {['W','D','4H','1H'].map(tf => {
                  const s = sig?.[tf];
                  const xs = s?.xs ?? 0;
                  const since = s?.since ?? 0;
                  const sym = xs===2?'🚀':xs===1?'▲':xs===-1?'▽':xs===-2?'☄️':'·';
                  const cls = xs>=2 ? styles.chipBull2
                    : xs>=1 ? styles.chipBull1
                    : xs<=-2 ? styles.chipBear2
                    : xs<=-1 ? styles.chipBear1
                    : styles.chipNeutral;
                  return (
                    <span key={tf} className={`${styles.sigChip} ${cls}`}>
                      {tf} {sym}{since > 1 ? ` (${since >= 100 ? '99+' : since})` : ''}
                    </span>
                  );
                })}
              </div>
              <ScorePanel score={compositeScore} />
              <FundamentalBackdrop
                ticker={ticker}
                isBull={isBull}
                spot={spot}
                fundamentals={fundamentals}
                loading={fundLoading}
              />
            </div>
          )}
          {activeTab==='trade' && (
            <TradeRecommendationTab
              ticker={ticker}
              spot={spot}
              isBull={isBull}
              conviction={conviction}
              account={account}
              params={params}
              ivOverride={ivOverride}
              sig={sig}
              fundamentals={fundamentals}
              compositeScore={compositeScore}
              earningsDte={earningsDte}
              isCounterTrend={isCounterTrend}
              rangePos={rangePos}
            />
          )}
          {activeTab==='probe' && (
            <ProbeTab
              ticker={ticker}
              spot={spot}
              isBull={isBull}
              sig={sig}
              compositeScore={compositeScore}
            />
          )}
          {activeTab==='manage' && (
            <ManageTab
              positions={activePositions}
              price={spot}
              ticker={ticker}
              sig={sig}
            />
          )}
        </div>

      </div>
    </div>,
    document.body
  );
}
