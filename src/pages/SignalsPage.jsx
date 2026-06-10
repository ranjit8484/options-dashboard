import React, { useMemo, useState } from 'react';
import {
  BUCKETS, HARD_AVOID_NAKED,
  getBucket, getConflicts
} from '../config/buckets';
import { ResearchCard } from '../components/ResearchCard';
import { loadParams, tickerCollStatus } from '../hooks/useParams';
import { calcCollateral, calcComposite, calcEntry, calcStrategy,
  calcCompositeScore } from '../lib/finance';
import { getLeapExpiries } from '../lib/strikeCalc';
import styles from './SignalsPage.module.css';


// ── Conviction sort order ─────────────────────────────
const CONV_ORDER = { full:0, high:1, medium:2, low:3, none:4, exit:5 };

// ── Readiness tier for E19 signal ranking ────────────
// Returns 0 (best) to 4 (worst) for sorting
function getReadinessTier(row, fundamentals, spot, ticker, signals) {
  const { sig } = row;
  if (!sig) return 4;

  const cs = calcCompositeScore({
    sig,
    fundamentals: fundamentals ?? null,
    spot: spot ?? null,
    marketSig: ticker && ticker !== 'QQQ' ? (signals?.['QQQ'] ?? null) : null
  });

  if (!cs) return 4;

  const thesis = sig?._strategy?.thesis ?? '';
  const conviction = sig?._strategy?.conviction ?? 'none';
  const isConflicted = thesis.toLowerCase().includes('conflict')
    || thesis.toLowerCase().includes('sideways')
    || thesis.toLowerCase().includes('watch')
    || conviction === 'low'
    || conviction === 'none';

  // Counter-trend: mature BLOCK signal at range extreme
  const rangePos = cs.rangePos ?? null;
  const isBull = (sig?._entry?.dir ?? '') === 'long';
  const wSince = sig?.W?.since ?? 0;
  const isCounterTrend = cs.tier === 'BLOCK'
    && rangePos !== null
    && wSince >= 10
    && (
      (isBull  && rangePos > 0.80)
      || (!isBull && rangePos < 0.20)
    );

  if (isCounterTrend) return 2;

  // Only PRIME and GOOD are eligible for Trade Now / Watch
  // MARGINAL stays MARGINAL regardless of gates
  if (cs.tier !== 'PRIME' && cs.tier !== 'GOOD') {
    if (cs.tier === 'MARGINAL' && !isConflicted) return 3;
    return 4;
  }

  // Conflicted PRIME/GOOD → MARGINAL
  if (isConflicted) return 3;

  // Check entry gates using same fields as getEntryTriggers
  // macdHist not available — use macdDir instead
  const h4 = sig?.['4H'] ?? {};
  const h1 = sig?.['1H'] ?? {};
  const h4xs      = h4.xs ?? 0;
  const h1xs      = h1.xs ?? 0;
  const h4MacdDir = h4.macdDir ?? '';
  const h4MacdCross = h4.macdCross ?? null;

  // Gate 3: 4H or 1H timing confirmed
  const timingOk = isBull
    ? (h4xs >= 1 || h1xs >= 1)
    : (h4xs <= -1 || h1xs <= -1);

  // Gate 4: MACD supporting
  // Use macdDir or fresh cross as proxy
  const macdOk = isBull
    ? (h4MacdDir === 'bull' || h4MacdCross === 'bull')
    : (h4MacdDir === 'bear' || h4MacdCross === 'bear');

  const gatesReady = timingOk && macdOk;
  const almostReady = timingOk || macdOk;

  // All gates clear → Trade Now
  // One gate pending → Watch
  // No gates → still Watch (valid setup, just timing)
  return gatesReady ? 0 : 1;
}

// Tier labels and styles for display
const TIER_META = {
  0: { label: 'Trade now',          cls: 'tierTradeNow',  short: 'TRADE NOW'  },
  1: { label: 'Watch',              cls: 'tierWatch',     short: 'WATCH'      },
  2: { label: 'Counter-trend probe',cls: 'tierCounter',   short: 'COUNTER'    },
  3: { label: 'Marginal',           cls: 'tierMarginal',  short: 'MARGINAL'   },
  4: { label: 'No trade',           cls: 'tierNone',      short: 'NO TRADE'   },
};

// ── Exit badge helper for active short positions ──────
function getSpreadExitBadge(pos, price) {
  if (!pos || !price) return null;
  const isShort = pos.dir === 'sc' || pos.dir === 'sp';
  if (!isShort) return null;

  const diff = pos.dir === 'sc'
    ? price - pos.k
    : pos.k - price;
  const atRisk   = diff > 0;
  const buffer   = Math.abs(price - pos.k);
  const bufferPct = (buffer / price * 100).toFixed(1);
  const dte       = pos.dte ?? 999;

  if (atRisk)
    return { label: '↗ BREACHED', cls: 'exitDanger' };
  if (buffer < (pos.spreadWidth ?? 50) * 0.3 || dte <= 5)
    return { label: `→ $${Math.round(buffer)} buffer`, cls: 'exitWatch' };

  const profitPct = pos.prem > 0
    ? Math.round((1-(Math.max(0,diff)/pos.prem))*100) : 0;
  if (profitPct >= 50)
    return { label: `✓ ${profitPct}% profit`, cls: 'exitSafe' };

  return { label: `✓ ${bufferPct}% buffer`, cls: 'exitSafe' };
}

// ── Signal chip ───────────────────────────────────────
function TfChip({ sig, tf }) {
  const sym = { 2:'🚀', 1:'▲', 0:'·', '-1':'▽', '-2':'☄️' };
  const cls = {
    2: styles.chipBull2, 1: styles.chipBull1,
    0: styles.chipNone,
   '-1': styles.chipBear1, '-2': styles.chipBear2
  };
  const since = sig?.since && sig.since > 0
    ? ` (${sig.since >= 100 ? '99+' : sig.since})`
    : '';
  const colorCls = sig ? (cls[sig.xs] ?? styles.chipNone) : styles.chipNone;
  return (
    <span className={`${styles.chip} ${colorCls}`}>
      <span className={styles.chipSym}>{sig ? (sym[sig.xs] ?? '·') : '·'}</span>
      {tf && (
        <span className={styles.chipTf}>{tf}{since}</span>
      )}
    </span>
  );
}

// ── Trade label badge class helper ────────────────────
function tradeLabelClass(label) {
  if (!label) return styles.tradeWatch;
  const l = label.toLowerCase();
  if (l.includes('naked')) return styles.tradeNaked;
  if (l.includes('credit') || l.includes('spread')) return styles.tradeCredit;
  if ((l.includes('leap')) || (l.includes('call') && l.includes('buy'))
      || (l.includes('put') && l.includes('buy'))) return styles.tradeLeap;
  if (l.includes('condor')) return styles.tradeCondor;
  return styles.tradeWatch;
}

// ── Per-ticker rule check ─────────────────────────────
function getRuleViolations(ticker, bucket, sig, activeTickers,
  groups, params, prices, balances) {
  const p = params ?? loadParams();

  // Count unique active tickers (not position legs)
  const totalTickers = activeTickers.length;
  const max          = p.maxTotalTickers ?? 15;

  const bucketCounts = {};
  activeTickers.forEach(t => {
    const b = getBucket(t); if (b) bucketCounts[b] = (bucketCounts[b]||0)+1;
  });
  const bucketCount = bucketCounts[bucket] || 0;
  const conflicts   = getConflicts(ticker, activeTickers);
  const isNaked     = sig?._strategy?.variant === 'naked';
  const isHardAvoid = HARD_AVOID_NAKED.includes(ticker) && isNaked;
  const isBucketF   = bucket === 'F' && isNaked;

  const violations = [];
  if (totalTickers >= max)
    violations.push({ type:'hard', msg:`Max tickers reached (${totalTickers}/${max})` });
  if (bucketCount >= p.maxPerBucket)
    violations.push({ type:'hard', msg:`Bucket ${bucket} full (${bucketCount}/${p.maxPerBucket})` });

  const nakedTickers = groups.filter(g =>
    g.pos.some(p => p.dir === 'sc' || p.dir === 'sp')
  ).length;
  if (nakedTickers >= (p.maxNakedPositions ?? 4) && isNaked)
    violations.push({ type:'warn',
      msg: `Max naked positions (${nakedTickers}/${p.maxNakedPositions ?? 4})` });

  if (prices && balances) {
    const total = (balances.rh||0) + (balances.fid||0);
    if (total > 0 && sig?._strategy) {
      const estStrike = prices[ticker] ?? 100;
      const estColl   = isNaked
        ? Math.max((0.20 * estStrike) * 100, 0.10 * estStrike * 100)
        : 50 * 100;
      const status = tickerCollStatus(estColl, total, p);
      if (status === 'block')
        violations.push({ type:'hard',
          msg: `Would exceed ${p.blockTickerCollPct}% collateral limit` });
      else if (status === 'warn')
        violations.push({ type:'warn',
          msg: `Would reach ${p.warnTickerCollPct}% collateral warning` });
    }
  }

  if (conflicts.length > 0)
    conflicts.forEach(c => violations.push({ type:'hard', msg: c }));
  if (isHardAvoid)
    violations.push({ type:'hard', msg:'Hard avoid — no naked calls' });
  if (isBucketF)
    violations.push({ type:'hard', msg:'Bucket F — spreads only' });
  return violations;
}

// ── Portfolio status bar ──────────────────────────────
function PortfolioBar({ groups, params, prices, balances }) {
  const p = params ?? loadParams();
  const activeTickers = groups.map(g => g.t);
  const totalOpen = activeTickers.length;
  const max = p.maxTotalTickers ?? 15;
  const totalAccount = (balances?.rh || 0) + (balances?.fid || 0);
  const bucketCounts = {};
  activeTickers.forEach(t => {
    const b = getBucket(t); if (b) bucketCounts[b] = (bucketCounts[b]||0)+1;
  });
  const fullBuckets = Object.entries(bucketCounts)
    .filter(([b,c]) => c >= (p.maxPerBucket ?? BUCKETS[b]?.maxPositions ?? 2));

  return (
    <div className={styles.portfolioBar}>
      <div className={styles.pbItem}>
        <span className={styles.pbLabel}>Open</span>
        <span className={`${styles.pbVal} ${totalOpen >= max ? styles.pbFull : styles.pbOk}`}>
          {totalOpen}/{max} {totalOpen >= max ? '🔴' : '✅'}
        </span>
      </div>
      {fullBuckets.map(([b,c]) => (
        <div key={b} className={styles.pbItem}>
          <span className={styles.pbLabel}>Bucket {b}</span>
          <span className={`${styles.pbVal} ${styles.pbFull}`}>
            {c}/{p.maxPerBucket ?? 2} 🔴
          </span>
        </div>
      ))}
      {totalAccount > 0 && (() => {
        const heaviest = groups.reduce((best, g) => {
          const price = prices?.[g.t] ?? 100;
          const coll  = g.pos.reduce(
            (s, pos) => s + calcCollateral(pos.dir, pos.k, pos.prem, pos.qty, price, pos.spreadWidth, pos.coveredByLeap, pos.leapCost, pos.diagonalWidth), 0
          );
          const pct = Math.round(coll / totalAccount * 100);
          return pct > best.pct ? { t: g.t, pct } : best;
        }, { t: '', pct: 0 });
        if (heaviest.pct < (p.warnTickerCollPct ?? 20)) return null;
        return (
          <div className={styles.pbItem}>
            <span className={styles.pbLabel}>Top coll</span>
            <span className={`${styles.pbVal} ${heaviest.pct >= (p.blockTickerCollPct ?? 50) ? styles.pbFull : styles.pbWarn}`}>
              {heaviest.t} {heaviest.pct}%
              {heaviest.pct >= (p.blockTickerCollPct ?? 50) ? ' 🔴' : ' 🟡'}
            </span>
          </div>
        );
      })()}
    </div>
  );
}

// ── Opportunity card (clean, no violations) ───────────
function OpportunityCard({ ticker, bucket, sig, onOpenResearch }) {
  const tfs = ['W','D','4H','1H'];
  return (
    <div className={styles.oppCard} onClick={() => onOpenResearch(ticker, sig)}>
      <div className={styles.oppCardLeft}>
        <span className={styles.oppTicker}>{ticker}</span>
        <span className={styles.oppBucket}>Bkt {bucket}</span>
      </div>
      <div className={styles.oppCardMid}>
        <span className={`${styles.oppThesis} ${styles[`conv_${sig._strategy.conviction}`]}`}>
          {sig._strategy.thesis}
        </span>
        <span className={`${styles.oppLabel} ${tradeLabelClass(sig._strategy.label)}`}>
          {sig._strategy.label}
        </span>
      </div>
      <div className={styles.oppChips}>
        {tfs.map(tf => <TfChip key={tf} tf={tf} sig={sig?.[tf]} />)}
      </div>
      <span className={styles.oppClick}>↗ details</span>
    </div>
  );
}

// ── Watch card (good signal but has violations) ───────
function WatchCard({ ticker, bucket, sig, violations, onOpenResearch }) {
  const tfs = ['W','D','4H','1H'];
  return (
    <div className={styles.watchCard} onClick={() => onOpenResearch(ticker, sig)}>
      <div className={styles.oppCardLeft}>
        <span className={styles.oppTicker}>{ticker}</span>
        <span className={styles.oppBucket}>Bkt {bucket}</span>
      </div>
      <div className={styles.oppCardMid}>
        <span className={`${styles.oppThesis} ${styles[`conv_${sig._strategy.conviction}`]}`}>
          {sig._strategy.thesis}
        </span>
        <span className={`${styles.oppLabel} ${tradeLabelClass(sig._strategy.label)}`}>
          {sig._strategy.label}
        </span>
      </div>
      <div className={styles.oppChips}>
        {tfs.map(tf => <TfChip key={tf} tf={tf} sig={sig?.[tf]} />)}
      </div>
      <div className={styles.watchViolations}>
        {violations.map((v,i) => (
          <span key={i} className={styles.watchViolBadge}>⚠ {v.msg}</span>
        ))}
      </div>
    </div>
  );
}

// ── Ticker Search ─────────────────────────────────────
function TickerSearch({ onResult, prices }) {
  const [query,   setQuery]   = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  async function analyze() {
    const ticker = query.trim().toUpperCase();
    if (!ticker) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/exec?action=history&tickers=${ticker}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);

      const history = json.history?.[ticker];
      if (!history) throw new Error(`No data found for ${ticker}`);

      const TIMEFRAMES = [
        { key:'W',  interval:'1wk' },
        { key:'D',  interval:'1d'  },
        { key:'4H', interval:'4h'  },
        { key:'1H', interval:'1h'  },
      ];

      const computed = {};
      for (const tf of TIMEFRAMES) {
        try {
          const raw = history[tf.key] ?? [];
          const candles = raw.map(c => ({
            h: c[1], l: c[2], c: c[3]
          }));
          computed[tf.key] = calcComposite(candles);
        } catch {
          computed[tf.key] = null;
        }
      }

      computed._entry    = calcEntry(computed);
      computed._strategy = calcStrategy(computed._entry, computed);

      // Use cached price if available
      let spot = prices?.[ticker] ?? null;

      // If no cached price, fetch via Yahoo Finance
      // through GScript (avoids Finnhub rate limits)
      if (!spot) {
        try {
          // Reuse the history candles we already fetched
          // Get the last close from the Daily candle data
          const dailyCandles = history['D'] ?? [];
          if (dailyCandles.length > 0) {
            const lastCandle = dailyCandles[dailyCandles.length - 1];
            // candle format is [timestamp, high, low, close]
            if (lastCandle[3] > 0) spot = lastCandle[3];
          }
        } catch {
          // keep spot as null
        }
      }

      onResult({ ticker, sig: computed, spot });

    } catch (err) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e) {
    if (e.key === 'Enter') analyze();
  }

  return (
    <div className={styles.searchBar}>
      <span className={styles.searchIcon}>🔍</span>
      <input
        className={styles.searchInput}
        type="text"
        placeholder="Search any ticker — e.g. TSLA, HOOD, PLTR"
        value={query}
        onChange={e => setQuery(e.target.value.toUpperCase())}
        onKeyDown={handleKey}
        maxLength={10}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="characters"
      />
      <button
        className={styles.searchBtn}
        onClick={analyze}
        disabled={loading || !query.trim()}
      >
        {loading ? '⟳ Loading…' : 'Analyze →'}
      </button>
      {error && (
        <span className={styles.searchError}>⚠ {error}</span>
      )}
    </div>
  );
}

// ── LEAP Harvest Panel ────────────────────────────────
export function LeapHarvestPanel({ groups, prices, closed, signals, onOpenResearch, plat }) {
  const [open, setOpen] = useState(true);

  const items = useMemo(() => {
    const list = [];
    const platFilter = (!plat || plat === 'ALL') ? null : plat.toUpperCase();
    const filteredGroups = !platFilter
      ? groups
      : groups.filter(g =>
          g.pos.some(p =>
            (p.dir === 'lc' || p.dir === 'lp') &&
            (p.dte ?? 0) > 0 &&
            (p.plat || '').toUpperCase() === platFilter
          )
        );
    filteredGroups.forEach(g => {
      const leaps = g.pos.filter(p =>
        (p.dir === 'lc' || p.dir === 'lp') &&
        (p.dte ?? 0) > 0 &&
        (!platFilter || (p.plat || '').toUpperCase() === platFilter)
      );
      if (!leaps.length) return;

      const allShorts = g.pos.filter(p =>
        (p.dir === 'sc' || p.dir === 'sp') && (p.dte ?? 0) > 0
      );

      leaps.forEach((leap, idx) => {
        const activeHedge = allShorts[idx] ?? null;
        const leapDir = leap.dir === 'lc' ? 'call' : 'put';
        const isCallLeap = leap.dir === 'lc';

        let harvested = 0;
        const leapOpenDate = leap.openDate
          ? new Date(leap.openDate) : null;
        const leapCallPut = isCallLeap ? 'CALL' : 'PUT';
        const leapPlat = (leap.plat || '').toUpperCase();
        if (closed) {
          closed.forEach(c => {
            const ct = (c.ticker || '').toString().trim().toUpperCase();
            if (ct !== g.t.toUpperCase()) return;
            // Must match platform
            const cp = (c.platform || '').toUpperCase();
            if (leapPlat && cp && cp !== leapPlat) return;
            // Must be opened after the LEAP
            if (leapOpenDate && c.openDate) {
              const tradeOpen = new Date(c.openDate);
              if (tradeOpen < leapOpenDate) return;
            }
            // Must be same type as LEAP
            if (c.callPut && c.callPut !== leapCallPut) return;
            // Must be hedge/harvest trade type only
            const tt = (c.tradeType || '').toLowerCase();
            const isHedge = tt.includes('hedge') || tt.includes('harvest')
              || tt.includes('pmcc') || tt.includes('pmcp')
              || tt.includes('covered');
            if (!isHedge) return;
            // Must be a credit trade
            const credit = parseFloat(c.credit || 0);
            if (credit <= 0) return;
            harvested += credit * 100;
          });
        }

        const leapCost  = leap.prem * 100 * (leap.qty || 1);
        const leapCostDollars  = Math.round(leapCost);
        const harvestedDollars = Math.round(harvested);
        const offsetPct = leapCost > 0
          ? Math.min(100, Math.round(harvested / leapCost * 100)) : 0;
        const paidOff = harvestedDollars >= leapCostDollars;

        if (activeHedge) {
          list.push({
            ticker: g.t,
            leap, activeHedge,
            offsetPct, leapCost, harvested,
            leapCostDollars, harvestedDollars,
            leapDir, isCallLeap, paidOff,
            plat: leap.plat,
            urgency: 'safe',
            action: activeHedge.dte <= 7
              ? `Expires in ${activeHedge.dte}d — prepare next sale`
              : `Active · ${activeHedge.dte}d left`,
          });
        } else {
          list.push({
            ticker: g.t,
            leap, activeHedge: null,
            offsetPct, leapCost, harvested,
            leapCostDollars, harvestedDollars,
            leapDir, isCallLeap, paidOff,
            plat: leap.plat,
            urgency: 'warn',
            action: `No harvest open — sell ${leapDir} now`,
          });
        }
      });
    });
    // Shared scale — largest cost = reference point
    const maxCost = list.reduce((m, i) => Math.max(m, i.leapCost), 1);
    list.forEach(item => {
      item.scaledPct = Math.min(100, Math.round(item.leapCost / maxCost * 100));
      item.scaledHarvestPct = Math.min(100, Math.round(item.harvested / maxCost * 100));
      // Pace: harvest per week since LEAP opened
      const leapOpenDate = item.leap.openDate ? new Date(item.leap.openDate) : null;
      const weeksOpen = leapOpenDate
        ? Math.max(1, (Date.now() - leapOpenDate) / (7 * 86400000))
        : 1;
      const weeklyPace = item.harvested / weeksOpen;
      const remainingCost = Math.max(0, item.leapCost - item.harvested);
      item.weeklyPace = Math.round(weeklyPace);
      item.weeksToPayoff = weeklyPace > 0
        ? Math.ceil(remainingCost / weeklyPace) : null;
      // LEAP DTE — use pre-calculated dte from parseRows directly
      item.leapDte = item.leap.dte ?? null;
    });
    // Classify into 3 sections
    list.forEach(item => {
      const hedgeExpiring = item.activeHedge && (item.activeHedge.dte ?? 99) <= 7;
      if (hedgeExpiring) {
        item.section = 'expiring';
        item.sectionOrder = 0;
      } else if (!item.activeHedge) {
        item.section = 'noHarvest';
        item.sectionOrder = 1;
      } else {
        item.section = 'active';
        item.sectionOrder = 2;
      }
    });

    // Sort by section then by leapDte ascending within noHarvest
    return list.sort((a, b) => {
      if (a.sectionOrder !== b.sectionOrder)
        return a.sectionOrder - b.sectionOrder;
      // Within noHarvest: shortest LEAP DTE first (most urgent)
      if (a.section === 'noHarvest') {
        return (a.leapDte ?? 999) - (b.leapDte ?? 999);
      }
      return 0;
    });
  }, [groups, prices, closed]);

  const totalCost      = items.reduce((s, i) => s + i.leapCost, 0);
  const totalHarvested = items.reduce((s, i) => s + i.harvested, 0);
  const totalWeeklyPace = items.reduce((s, i) => s + (i.weeklyPace || 0), 0);
  const noHarvestCount = items.filter(i => i.section === 'noHarvest').length;
  const expiringCount  = items.filter(i => i.section === 'expiring').length;
  const weeksToFullPayoff = totalWeeklyPace > 0
    ? Math.ceil((totalCost - totalHarvested) / totalWeeklyPace) : null;

  return (
    <div className={styles.leapHarvestPanel}>
      <button
        className={styles.leapHarvestHeader}
        onClick={() => setOpen(o => !o)}>
        <span className={styles.leapHarvestTitle}>💰 LEAP Harvest</span>
        {expiringCount > 0 && (
          <span className={styles.leapHarvestBadgeRed}>
            {expiringCount} expiring
          </span>
        )}
        {noHarvestCount > 0 && (
          <span className={styles.leapHarvestBadge}>
            {noHarvestCount} not harvesting
          </span>
        )}
        {noHarvestCount === 0 && expiringCount === 0 && (
          <span className={styles.leapHarvestGood}>all active ✓</span>
        )}
        <span style={{marginLeft:'auto',fontSize:'11px',
          color:'var(--text3)'}}>
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <div className={styles.leapHarvestSummary}>
          <div className={styles.leapHarvestSumItem}>
            <span className={styles.leapHarvestSumLabel}>Total cost</span>
            <span className={styles.leapHarvestSumVal}>
              ${Math.round(totalCost / 1000)}k
            </span>
            <span className={styles.leapHarvestSumSub}>
              {items.length} LEAPs
            </span>
          </div>
          <div className={styles.leapHarvestSumItem}>
            <span className={styles.leapHarvestSumLabel}>Recovered</span>
            <span className={styles.leapHarvestSumVal}
              style={{color: totalHarvested > 0 ? '#22c55e' : 'var(--text3)'}}>
              ${Math.round(totalHarvested).toLocaleString()}
            </span>
            <span className={styles.leapHarvestSumSub}>
              {totalCost > 0
                ? Math.round(totalHarvested / totalCost * 100) : 0}% of cost
            </span>
          </div>
          <div className={styles.leapHarvestSumItem}>
            <span className={styles.leapHarvestSumLabel}>Weekly pace</span>
            <span className={styles.leapHarvestSumVal}>
              {totalWeeklyPace > 0
                ? `$${totalWeeklyPace.toLocaleString()}` : '—'}
            </span>
            <span className={styles.leapHarvestSumSub}>
              {weeksToFullPayoff ? `payoff ~${weeksToFullPayoff}w` : 'no harvests open'}
            </span>
          </div>
          <div className={styles.leapHarvestSumItem}>
            <span className={styles.leapHarvestSumLabel}>No harvest open</span>
            <span className={styles.leapHarvestSumVal}
              style={{color: noHarvestCount > 0 ? '#f97316' : '#22c55e'}}>
              {noHarvestCount}
            </span>
            <span className={styles.leapHarvestSumSub}>
              {noHarvestCount > 0 ? 'leaving money on table' : 'all covered ✓'}
            </span>
          </div>
        </div>
      )}
      {open && (
        <div className={styles.leapHarvestBody}>
          {['expiring','noHarvest','active'].map(section => {
            const sectionItems = items.filter(i => i.section === section);
            if (!sectionItems.length) return null;
            const sectionMeta = {
              expiring:  { dot: '#ef4444', label: 'Expiring soon — open next harvest now' },
              noHarvest: { dot: '#f97316', label: 'No harvest open — sell one now' },
              active:    { dot: '#22c55e', label: 'Active harvest — running' },
            }[section];
            return (
              <div key={section}>
                <div className={styles.leapSectionHdr}>
                  <span className={styles.leapSectionDot}
                    style={{background: sectionMeta.dot}} />
                  <span className={styles.leapSectionLabel}>
                    {sectionMeta.label}
                  </span>
                  <span className={styles.leapSectionCount}>
                    {sectionItems.length}
                  </span>
                </div>
                {sectionItems.map((item, i) => {
                  const isExpiring = section === 'expiring';
                  const isNoHarvest = section === 'noHarvest';
                  const leapUrgent = (item.leapDte ?? 999) <= 45;
                  // Suggested target strike
                  const price = prices?.[item.ticker];
                  const suggestedStrike = price
                    ? Math.round(price * (item.isCallLeap ? 1.08 : 0.92) / 5) * 5
                    : null;
                  // Weeks since LEAP opened
                  const leapOpenDate = item.leap.openDate
                    ? new Date(item.leap.openDate) : null;
                  const weeksSinceOpen = leapOpenDate
                    ? Math.round((Date.now() - leapOpenDate) / (7 * 86400000))
                    : null;

                  return (
                    <div key={i}
                      className={`${styles.leapHarvestRow}
                        ${isExpiring ? styles.leapRowExpiring
                          : isNoHarvest ? styles.leapRowNoHarvest
                          : styles.leapRowActive}`}
                      style={{cursor: onOpenResearch ? 'pointer' : 'default'}}
                      onClick={() => onOpenResearch && onOpenResearch(
                        item.ticker,
                        signals?.[item.ticker] ?? null,
                        groups?.find(g => g.t === item.ticker)?.pos ?? []
                      )}>

                      {/* Left */}
                      <div className={styles.leapHarvestLeft}>
                        <div style={{display:'flex',alignItems:'center',gap:'5px'}}>
                          <span className={styles.leapHarvestTicker}>{item.ticker}</span>
                          {item.plat === 'RH' && (
                            <span style={{display:'inline-flex',alignItems:'center',gap:'3px',padding:'1px 5px',borderRadius:'3px',fontSize:'9px',fontFamily:'monospace',fontWeight:'700',background:'rgba(202,255,0,.1)',border:'1px solid rgba(202,255,0,.2)',color:'#7a9900'}}>
                              <svg width="9" height="9" viewBox="0 0 14 14"><rect width="14" height="14" rx="3" fill="#CAFF00"/><path d="M7 12 C7 12 5.5 8 7 5.5 C8.5 3 10 5 9.5 7 C9 9 7 9 7 12Z" fill="#111"/></svg>RH
                            </span>
                          )}
                          {item.plat === 'FID' && (
                            <span style={{display:'inline-flex',alignItems:'center',gap:'3px',padding:'1px 5px',borderRadius:'3px',fontSize:'9px',fontFamily:'monospace',fontWeight:'700',background:'rgba(27,94,32,.1)',border:'1px solid rgba(139,105,20,.2)',color:'#C8A951'}}>
                              <svg width="9" height="9" viewBox="0 0 14 14"><rect width="14" height="14" rx="3" fill="#1B5E20"/><circle cx="7" cy="7" r="5" fill="#2E7D32"/><polygon points="7,3 9.5,11 7,9.5 4.5,11" fill="#C8A951"/></svg>FID
                            </span>
                          )}
                        </div>
                        <span className={styles.leapHarvestLbl}>
                          {item.leap.k} Long {item.leapDir === 'call' ? 'Call' : 'Put'}
                          · {item.leap.exp}
                        </span>
                        {item.leapDte !== null && (
                          <span className={styles.leapDtePill}
                            style={{
                              background: item.leapDte < 30
                                ? 'rgba(239,68,68,.12)'
                                : item.leapDte < 60
                                ? 'rgba(245,158,11,.12)'
                                : 'var(--bg3)',
                              color: item.leapDte < 30 ? '#dc2626'
                                : item.leapDte < 60 ? '#b45309'
                                : 'var(--text3)'
                            }}>
                            {item.leapDte}d left
                          </span>
                        )}
                      </div>

                      {/* Pct */}
                      <div className={styles.leapPctCol}
                        style={{color: item.offsetPct >= 50 ? '#22c55e'
                          : item.offsetPct >= 20 ? '#f59e0b'
                          : item.offsetPct > 0 ? '#ef4444'
                          : 'var(--text3)'}}>
                        {item.offsetPct > 0 ? `${item.offsetPct}%` : '—'}
                      </div>

                      {/* Bar + amounts */}
                      <div className={styles.leapHarvestMid}>
                        <div className={styles.leapHarvestProgressWrap}>
                          <div className={styles.leapHarvestProgressBg}
                            style={{width:`${item.scaledPct}%`, minWidth:'4px'}}>
                            <div className={styles.leapHarvestBar}
                              style={{
                                width: item.leapCost > 0
                                  ? `${Math.min(100, Math.round(item.harvested / item.leapCost * 100))}%`
                                  : '0%',
                                background: item.paidOff ? '#00C805'
                                  : item.offsetPct >= 50 ? '#22c55e'
                                  : item.offsetPct >= 25 ? '#f59e0b'
                                  : item.offsetPct > 0 ? '#ef4444'
                                  : 'transparent'
                              }}
                            />
                          </div>
                        </div>
                        <div className={styles.leapBarRow}>
                          <span className={styles.leapBarAmounts}>
                            <span style={{
                              color: item.harvestedDollars > 0 ? '#22c55e' : 'var(--text3)',
                              fontWeight: '700'
                            }}>
                              ${item.harvestedDollars.toLocaleString()}
                            </span>
                            <span style={{color:'var(--text3)',margin:'0 3px'}}>/</span>
                            <span style={{color:'var(--text2)'}}>
                              ${item.leapCostDollars.toLocaleString()}
                            </span>
                            {weeksSinceOpen !== null && isNoHarvest && (
                              <span style={{color:'var(--text3)',marginLeft:'6px',fontSize:'10px'}}>
                                · opened {weeksSinceOpen}w ago
                              </span>
                            )}
                          </span>
                          <span className={styles.leapBarPace}
                            style={{
                              color: isExpiring ? '#ef4444'
                                : isNoHarvest && leapUrgent ? '#f97316'
                                : 'var(--text3)'
                            }}>
                            {isExpiring && item.activeHedge
                              ? `${item.activeHedge.lbl} expires in ${item.activeHedge.dte}d`
                              : isNoHarvest && leapUrgent
                              ? `LEAP expiring in ${item.leapDte}d — sell ${item.leapDir} urgently`
                              : isNoHarvest && suggestedStrike
                              ? `target $${suggestedStrike} ${item.leapDir} · Jun 26`
                              : item.weeklyPace > 0
                              ? `$${item.weeklyPace}/wk · ${item.weeksToPayoff}w to go`
                              : ''}
                          </span>
                        </div>
                      </div>

                      {/* Action chip */}
                      <div className={styles.leapHarvestRight}>
                        {isExpiring && (
                          <>
                            <span className={`${styles.leapActionChip} ${styles.leapChipRed}`}>
                              Expires in {item.activeHedge?.dte}d
                            </span>
                            <span className={styles.leapActionSub}>
                              sell next {item.leapDir} before this closes
                            </span>
                          </>
                        )}
                        {isNoHarvest && leapUrgent && (
                          <>
                            <span className={`${styles.leapActionChip} ${styles.leapChipOrange}`}>
                              Sell {item.leapDir} — urgent
                            </span>
                            <span className={styles.leapActionSub}>
                              {item.leapDte}d left on LEAP
                            </span>
                          </>
                        )}
                        {isNoHarvest && !leapUrgent && (
                          <>
                            <span className={`${styles.leapActionChip} ${styles.leapChipOrange}`}>
                              Sell {item.leapDir} now
                            </span>
                            <span className={styles.leapActionSub}>
                              {weeksSinceOpen
                                ? `${weeksSinceOpen}w since opened`
                                : 'start recovering cost'}
                            </span>
                          </>
                        )}
                        {section === 'active' && item.activeHedge && (
                          <>
                            <span className={`${styles.leapActionChip}
                              ${item.activeHedge.dte <= 7
                                ? styles.leapChipPurple
                                : styles.leapChipGreen}`}>
                              {item.activeHedge.lbl} · {item.activeHedge.dte}d
                            </span>
                            <span className={styles.leapActionSub}>
                              {item.activeHedge.dte <= 7
                                ? 'prepare next after expiry'
                                : 'harvest running'}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main export ───────────────────────────────────────
export function SignalsPage({
  groups, watchlist, signals, signalsLoading,
  progress, onRefresh, balances, prices, params,
  isPublic, closed
}) {
  const [researchTarget, setResearchTarget] = useState(null);
  const [searchResult,   setSearchResult]   = useState(null);
  const [bucketFilter, setBucketFilter] = useState('ALL');
  const [showFilter,   setShowFilter]   = useState('ALL');
  const [sortBy,       setSortBy]       = useState('readiness');

  const activeTickers = useMemo(() => groups.map(g => g.t), [groups]);
  const p = params ?? loadParams();

  // Build full ticker list with computed fields
  const allRows = useMemo(() => {
    const wlMap = {};
    watchlist.forEach(({ticker, bucket}) => { wlMap[ticker] = bucket; });
    // Also include active tickers not in watchlist
    activeTickers.forEach(t => { if (!wlMap[t]) wlMap[t] = getBucket(t) || '?'; });

    return Object.entries(wlMap).map(([ticker, bucket]) => {
      const sig      = signals[ticker];
      const isActive = activeTickers.includes(ticker);
      const suppressExit = !isActive && sig?._entry?.action === 'EXIT';
      const thesis   = suppressExit ? 'Watch' : (sig?._strategy?.thesis ?? '—');
      const label    = suppressExit ? '—'     : (sig?._strategy?.label  ?? '—');
      const conviction = suppressExit ? 'none' : (sig?._strategy?.conviction ?? 'none');
      const violations = isActive ? [] :
        getRuleViolations(ticker, bucket, sig, activeTickers, groups, p, prices, balances);
      const isBlocked  = violations.length > 0;
      const isOpportunity = !isActive && !isBlocked && !suppressExit &&
        conviction !== 'none' && conviction !== 'exit';
      const isWatch = !isActive && isBlocked && !suppressExit &&
        conviction !== 'none' && conviction !== 'exit';

      const readinessTier = getReadinessTier(
        { sig, ticker },
        null,
        prices?.[ticker] ?? null,
        ticker,
        signals
      );
      const cs = sig ? calcCompositeScore({
        sig,
        fundamentals: null,
        spot: prices?.[ticker] ?? null,
        marketSig: ticker !== 'QQQ' ? (signals?.['QQQ'] ?? null) : null
      }) : null;
      return {
        ticker, bucket, sig, isActive,
        thesis, label, conviction,
        violations, isBlocked,
        isOpportunity, isWatch,
        suppressExit,
        readinessTier,
        score: cs?.score ?? null,
        scoreTier: cs?.tier ?? null,
        phase: cs?.phase ?? null,
      };
    });
  }, [watchlist, signals, activeTickers, params]);

  // Opportunities (clean, trade now)
  const opportunities = useMemo(() =>
    allRows
      .filter(r => r.isOpportunity)
      .sort((a,b) => (CONV_ORDER[a.conviction]??9) - (CONV_ORDER[b.conviction]??9)),
  [allRows]);

  // Watch (good signal but rule conflict)
  const watchList = useMemo(() =>
    allRows
      .filter(r => r.isWatch)
      .sort((a,b) => (CONV_ORDER[a.conviction]??9) - (CONV_ORDER[b.conviction]??9)),
  [allRows]);

  // All tickers table with filters
  const tableRows = useMemo(() => {
    let rows = allRows;
    if (bucketFilter !== 'ALL') rows = rows.filter(r => r.bucket === bucketFilter);
    if (showFilter === 'ACTIVE')   rows = rows.filter(r => r.isActive);
    if (showFilter === 'TRADENOW') rows = rows.filter(r => r.readinessTier === 0);
    if (showFilter === 'WATCH')    rows = rows.filter(r => r.readinessTier === 1);
    if (showFilter === 'COUNTER')  rows = rows.filter(r => r.readinessTier === 2);
    if (showFilter === 'MARGINAL') rows = rows.filter(r => r.readinessTier === 3);
    return [...rows].sort((a,b) => {
      if (sortBy === 'readiness') {
        const tierDiff = (a.readinessTier ?? 4) - (b.readinessTier ?? 4);
        if (tierDiff !== 0) return tierDiff;
        return (CONV_ORDER[a.conviction] ?? 9) - (CONV_ORDER[b.conviction] ?? 9);
      }
      if (sortBy === 'conviction')
        return (CONV_ORDER[a.conviction] ?? 9) - (CONV_ORDER[b.conviction] ?? 9);
      if (sortBy === 'ticker')
        return a.ticker.localeCompare(b.ticker);
      if (sortBy === 'bucket')
        return (a.bucket||'').localeCompare(b.bucket||'');
      return 0;
    });
  }, [allRows, bucketFilter, showFilter, sortBy]);

  return (
    <div className={styles.page}>

      {/* ── Ticker Search ── */}
      <TickerSearch
        prices={prices}
        onResult={({ ticker, sig, spot }) => {
          setSearchResult({ ticker, sig, spot });
          setResearchTarget({
            ticker,
            sig,
            activePositions: groups.find(g => g.t === ticker)?.pos ?? [],
            fallbackSpot: spot,
          });
        }}
      />

      {/* ── Portfolio Status ── */}
      {!isPublic && (
        <PortfolioBar groups={groups} params={p} prices={prices} balances={balances} />
      )}


      {/* ── Inner tab bar ── */}
      {/* ── All Tickers Table ── */}
      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <span className={styles.sectionTitle}>All Tickers</span>
          <div className={styles.tableFilters}>
            <select
              className={styles.filterSelect}
              value={bucketFilter}
              onChange={e => setBucketFilter(e.target.value)}
            >
              <option value="ALL">All Buckets</option>
              {Object.entries(BUCKETS).map(([k,b]) => (
                <option key={k} value={k}>Bucket {k} — {b.name}</option>
              ))}
            </select>
            {[
              { id:'ALL',      label:'All' },
              { id:'ACTIVE',   label:'● Active' },
              { id:'TRADENOW', label:'⚡ Trade now' },
              { id:'WATCH',    label:'⏳ Watch' },
              { id:'COUNTER',  label:'↩ Counter' },
              { id:'MARGINAL', label:'Marginal' },
            ].map(f => (
              <button key={f.id}
                className={`${styles.filterPill} ${showFilter === f.id ? styles.filterActive : ''}`}
                onClick={() => setShowFilter(f.id)}>
                {f.label}
              </button>
            ))}
            <select
              className={styles.filterSelect}
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
            >
              <option value="readiness">Sort: Score</option>
              <option value="bucket">Sort: Bucket</option>
            </select>
          </div>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Bkt</th>
                <th>Score</th>
                <th>Thesis</th>
                <th>Trade</th>
                <th>Gates</th>
                <th>W</th>
                <th>D</th>
                <th>4H</th>
                <th>1H</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((r, idx) => {
                const prevTier = idx > 0
                  ? tableRows[idx-1].readinessTier : -1;
                const showDivider = sortBy === 'readiness'
                  && r.readinessTier !== prevTier;
                const tierMeta = TIER_META[r.readinessTier];
                return (
                  <React.Fragment key={r.ticker}>
                    {showDivider && tierMeta && (
                      <tr>
                        <td colSpan={99}
                          className={`${styles.tierDivider}
                            ${styles[tierMeta.cls + 'Div'] ?? ''}
                            ${r.readinessTier === 2 ? styles.tierCounterDiv : ''}
                          `}>
                          <span className={styles.tierDividerLabel}>
                            {r.readinessTier === 0 && '⚡ '}
                            {r.readinessTier === 1 && '⏳ '}
                            {r.readinessTier === 2 && '↩ '}
                            {r.readinessTier === 3 && ''}
                            {tierMeta.label}
                            {r.readinessTier === 2 && (
                              <span className={styles.tierCounterNote}>
                                · half size · opposite direction
                              </span>
                            )}
                          </span>
                        </td>
                      </tr>
                    )}
                    <TableRow
                      ticker={r.ticker}
                      bucket={r.bucket}
                      sig={r.sig}
                      isActive={r.isActive}
                      thesis={r.thesis}
                      label={r.label}
                      conviction={r.conviction}
                      violations={r.violations}
                      prices={prices}
                      groups={groups}
                      signals={signals}
                      readinessTier={r.readinessTier}
                      score={r.score}
                      phase={r.phase}
                      onOpenResearch={(t, s, positions, fallback) =>
                        setResearchTarget({
                          ticker: t,
                          sig: s,
                          activePositions: positions ?? [],
                          fallbackSpot: fallback
                            ?? prices?.[t] ?? null,
                        })
                      }
                    />
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          {tableRows.length === 0 && (
            <div className={styles.tableEmpty}>No tickers match filters</div>
          )}
        </div>
      </div>

      {/* ── Research Card ── */}
      {researchTarget && (
        <ResearchCard
          ticker={researchTarget.ticker}
          spot={prices?.[researchTarget.ticker]
            || researchTarget.fallbackSpot}
          sig={researchTarget.sig}
          activePositions={researchTarget.activePositions}
          balances={balances}
          onClose={() => setResearchTarget(null)}
          allSignals={signals}
        />
      )}

    </div>
  );
}

// ── Table Row ─────────────────────────────────────────
function TableRow({
  ticker, bucket, sig, isActive, thesis, label,
  conviction, violations, isBlocked, isOpportunity,
  signalsLoading, onOpenResearch, prices, groups,
  readinessTier, score, phase,
  // legacy row prop support
  row,
}) {
  // Support both flat props and legacy row object
  if (row) {
    ticker       = row.ticker;
    bucket       = row.bucket;
    sig          = row.sig;
    isActive     = row.isActive;
    thesis       = row.thesis;
    label        = row.label;
    conviction   = row.conviction;
    violations   = row.violations;
    isBlocked    = row.isBlocked;
    isOpportunity = row.isOpportunity;
    readinessTier = row.readinessTier;
  }

  const activePos = groups?.find(g => g.t === ticker)?.pos ?? [];
  const fallbackSpot = prices?.[ticker]
    ?? activePos[0]?.k ?? null;

  const tierRowCls = readinessTier === 0 ? styles.rowTradeNow
    : readinessTier === 1 ? styles.rowWatch
    : readinessTier === 2 ? styles.rowCounter
    : readinessTier === 3 ? styles.rowMarginal
    : styles.rowNoTrade;
  const rowCls = [
    styles.tableRow,
    isActive ? styles.rowActive : '',
    tierRowCls,
  ].join(' ');

  return (
    <tr className={rowCls} onClick={() => onOpenResearch(ticker, sig, activePos, fallbackSpot)}>
      <td>
        <span className={styles.tableTicker}>{ticker}</span>
        {isActive && <span className={styles.activeDot} title="Active position">●</span>}
      </td>
      <td><span className={styles.bucketPill}>{bucket}</span></td>
      <td>
        {score !== null && score !== undefined ? (
          <span className={`${styles.scoreChip} ${
            readinessTier === 0 ? styles.scoreChipGreen
            : readinessTier === 1 ? styles.scoreChipAmber
            : readinessTier === 2 ? styles.scoreChipPurple
            : readinessTier === 3 ? styles.scoreChipOrange
            : styles.scoreChipGrey
          }`}>
            {score}
          </span>
        ) : (
          <span className={styles.scoreChipGrey}>—</span>
        )}
        {isActive && <span className={styles.activeDot}>●</span>}
      </td>
      <td>
        <button
          className={`${styles.thesisBtn} ${styles[`conv_${conviction}`]}`}
          onClick={e => { e.stopPropagation(); onOpenResearch(ticker, sig, activePos, fallbackSpot); }}
          title="Click for explanation"
        >
          {signalsLoading && !sig ? '…' : thesis}
        </button>
      </td>
      <td>
        {sig?._strategy?.noTrade ? (
          <span className={styles.waitBadge}>⏸ Wait</span>
        ) : (
          <span className={`${styles.tradeBadge} ${tradeLabelClass(label)}`}>
            {label}
          </span>
        )}
        {activePos?.length > 0 && (() => {
          const shortPos = activePos.find(
            p => p.dir==='sc' || p.dir==='sp'
          );
          if (!shortPos) return null;
          const badge = getSpreadExitBadge(shortPos, prices?.[ticker]);
          if (!badge) return null;
          return (
            <span className={`${styles.exitBadge} ${styles[badge.cls]}`}>
              {badge.label}
            </span>
          );
        })()}
        {readinessTier !== undefined && (
          <span className={`${styles.tierBadge} ${styles[TIER_META[readinessTier]?.cls]}`}>
            {TIER_META[readinessTier]?.short}
          </span>
        )}
        {sig?._strategy?.description && (
          <div className={styles.sigDesc}>
            {sig._strategy.description}
          </div>
        )}
      </td>
      <td>
        {readinessTier === 0 && (
          <span className={styles.gateNow}>⚡ Enter</span>
        )}
        {readinessTier === 1 && (
          <span className={styles.gateWait}>⏳ Watch</span>
        )}
        {readinessTier === 2 && (
          <span className={styles.gateCounter}>↩ Probe</span>
        )}
        {(readinessTier === 3 || readinessTier === 4) && (
          <span className={styles.gateNa}>—</span>
        )}
      </td>
      <td><TfChip tf="W"  sig={sig?.W}  /></td>
      <td><TfChip tf="D"  sig={sig?.D}  /></td>
      <td><TfChip tf="4H" sig={sig?.['4H']} /></td>
      <td><TfChip tf="1H" sig={sig?.['1H']} /></td>
    </tr>
  );
}

// ── LEAP Setup Tab ────────────────────────────────────
function LeapSetupTab({ allRows, prices, signals, balances, groups, onOpenResearch }) {
  const leapCandidates = allRows.filter(r => {
    const sig = r.sig;
    if (!sig) return false;
    const W = sig.W, D = sig.D;
    if (!(W?.xs >= 2 && D?.xs >= 2)) return false;
    // Exclude tickers where user already has a LEAP
    const hasActiveLEAP = groups
      .find(g => g.t === r.ticker)
      ?.pos.some(p =>
        (p.dir === 'lc' || p.dir === 'lp') &&
        (p.dte ?? 0) > 0
      );
    return !hasActiveLEAP;
  });

  if (leapCandidates.length === 0) return (
    <div className={styles.leapEmpty}>
      No LEAP candidates right now. Requires W🚀 + D🚀 on both timeframes.
    </div>
  );

  return (
    <div className={styles.leapSetup}>
      <div className={styles.leapSetupNote}>
        Showing tickers where W🚀 + D🚀 — full alignment required for LEAP conviction.
        Click any row for strike recommendations.
      </div>
      {leapCandidates.map(r => {
        const spot = prices?.[r.ticker];
        const isBull = r.sig._entry?.dir !== 'short';

        return (
          <div key={r.ticker}
            className={styles.leapRow}
            onClick={() => onOpenResearch(
              r.ticker, r.sig,
              [], spot
            )}>
            <span className={styles.leapTicker}>{r.ticker}</span>
            <span className={styles.leapBucket}>Bkt {r.bucket}</span>
            <span className={styles.leapDir}>
              {isBull ? '🚀 LEAP Call' : '🚀 LEAP Put'}
            </span>
            {spot && (
              <span className={styles.leapPrice}>
                ${spot.toLocaleString(undefined,{maximumFractionDigits:2})}
              </span>
            )}
            <div className={styles.leapChips}>
              {['W','D','4H','1H'].map(tf => (
                <TfChip key={tf} tf={tf} sig={r.sig?.[tf]} />
              ))}
            </div>
            <span className={styles.leapCta}>Click for strikes →</span>
          </div>
        );
      })}
    </div>
  );
}
