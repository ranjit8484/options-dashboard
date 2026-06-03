import React, { useMemo, useState } from 'react';
import {
  BUCKETS, HARD_AVOID_NAKED,
  getBucket, getConflicts
} from '../config/buckets';
import { ResearchCard } from '../components/ResearchCard';
import { loadParams, tickerCollStatus } from '../hooks/useParams';
import { calcCollateral, calcComposite, calcEntry, calcStrategy } from '../lib/finance';
import { getLeapExpiries } from '../lib/strikeCalc';
import styles from './SignalsPage.module.css';

const FINNHUB_KEY = import.meta.env.VITE_FINNHUB_KEY;

// ── Conviction sort order ─────────────────────────────
const CONV_ORDER = { full:0, high:1, medium:2, low:3, none:4, exit:5 };

// ── Readiness tier for E19 signal ranking ────────────
// Returns 0 (best) to 4 (worst) for sorting
function getReadinessTier(row) {
  const { sig } = row;
  if (!sig) return 4;

  const W  = sig.W;
  const D  = sig.D;
  const h4 = sig['4H'];
  const h1 = sig['1H'];

  const wXs = W?.xs ?? 0;
  const dXs = D?.xs ?? 0;

  // Tier 4 — explicit no trade
  if (sig._strategy?.noTrade === true) return 4;
  if (wXs === 0 && dXs === 0) return 4;

  const isBull = wXs >= 1;
  const aligned = (wXs >= 1 && dXs >= 1)
    || (wXs <= -1 && dXs <= -1);

  // Tier 3 — only one TF or W/D conflict
  if (!aligned) return wXs !== 0 ? 3 : 4;

  // Extension blocks — cap at tier 3
  const kijunDist = Math.abs(D?.kijunDist ?? 0);
  if (kijunDist > 25) return 3;

  // 4H timing signals
  const h4Xs    = h4?.xs ?? 0;
  const h4Since = h4?.since ?? 0;
  const h1Xs    = h1?.xs ?? 0;

  // 4H briefly opposing trend = bounce entry
  const h4Bounce = (isBull  && h4Xs <= -1 && h4Since <= 8)
    || (!isBull && h4Xs >= 1  && h4Since <= 8);

  // 4H just turned in trend direction
  const h4Fresh = Math.abs(h4Xs) >= 1 && h4Since <= 4
    && ((isBull && h4Xs >= 1) || (!isBull && h4Xs <= -1));

  // 1H confirms trade direction
  const h1Confirms = (isBull  && h1Xs >= 1)
    || (!isBull && h1Xs <= -1);

  // MACD confirmation on daily
  const macdConfirms = (isBull  && D?.macdDir === 'bull')
    || (!isBull && D?.macdDir === 'bear');

  // RSI in healthy zone
  const dRsi = D?.rsi ?? 50;
  const rsiOk = isBull
    ? dRsi >= 35 && dRsi <= 72
    : dRsi >= 28 && dRsi <= 65;

  // Tier 0 READY — timing confirmed
  if (aligned && (h4Bounce || h4Fresh) && h1Confirms
    && kijunDist <= 20) return 0;

  // Tier 1 WATCH — almost ready, missing one thing
  if (aligned && (h4Bounce || h4Fresh || h1Confirms)
    && kijunDist <= 20) return 1;

  // Tier 1 also — MACD + RSI both confirm even
  // without perfect 4H timing
  if (aligned && macdConfirms && rsiOk
    && kijunDist <= 20) return 1;

  // Tier 2 WAIT — aligned but timing not there yet
  if (aligned && kijunDist <= 20) return 2;

  // Tier 2 also — aligned but slightly extended
  if (aligned) return 2;

  return 3;
}

// Tier labels and styles for display
const TIER_META = {
  0: { label: '🟢 READY',   cls: 'tierReady', short: 'READY' },
  1: { label: '⏳ WATCH',   cls: 'tierWatch', short: 'WATCH' },
  2: { label: '◐ WAIT',     cls: 'tierWait',  short: 'WAIT'  },
  3: { label: '○ WEAK',     cls: 'tierWeak',  short: 'WEAK'  },
  4: { label: '— NO TRADE', cls: 'tierNone',  short: 'NONE'  },
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
  const since = sig?.since && sig.since > 1
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
  const isRegime4   = p.volatilityRegime === 4;
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
  if (isRegime4 && isNaked)
    violations.push({ type:'hard', msg:'Regime 4 — no naked premium' });
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
      <div className={styles.pbItem}>
        <span className={styles.pbLabel}>Regime</span>
        <span className={`${styles.pbVal} ${p.volatilityRegime === 4 ? styles.pbFull : styles.pbOk}`}>
          {p.volatilityRegime} {p.volatilityRegime === 4 ? '🚨' : '✅'}
        </span>
      </div>
      {totalAccount > 0 && (() => {
        const heaviest = groups.reduce((best, g) => {
          const price = prices?.[g.t] ?? 100;
          const coll  = g.pos.reduce(
            (s, pos) => s + calcCollateral(pos.dir, pos.k, pos.prem, pos.qty, price), 0
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

// ── Main export ───────────────────────────────────────
export function SignalsPage({
  groups, watchlist, signals, signalsLoading,
  progress, onRefresh, balances, prices, params
}) {
  const [researchTarget, setResearchTarget] = useState(null);
  const [searchResult,   setSearchResult]   = useState(null);
  const [bucketFilter, setBucketFilter] = useState('ALL');
  const [showFilter,   setShowFilter]   = useState('ALL');
  const [sortBy,       setSortBy]       = useState('readiness');
  const [signalTab,    setSignalTab]    = useState('signals');

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
        { sig, ticker }
      );
      return {
        ticker, bucket, sig, isActive,
        thesis, label, conviction,
        violations, isBlocked,
        isOpportunity, isWatch,
        suppressExit,
        readinessTier,
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
    if (showFilter === 'ACTIVE') rows = rows.filter(r => r.isActive);
    if (showFilter === 'WATCH')  rows = rows.filter(r => !r.isActive);
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
      <PortfolioBar groups={groups} params={p} prices={prices} balances={balances} />

      {/* ── Inner tab bar ── */}
      <div className={styles.innerTabBar}>
        <button
          className={`${styles.innerTab} ${signalTab==='signals'?styles.innerTabActive:''}`}
          onClick={() => setSignalTab('signals')}>
          📡 Signals
        </button>
        <button
          className={`${styles.innerTab} ${signalTab==='leap'?styles.innerTabActive:''}`}
          onClick={() => setSignalTab('leap')}>
          🚀 LEAP Setup
        </button>
      </div>

      {signalTab === 'leap' && (
        <LeapSetupTab
          allRows={allRows}
          prices={prices}
          signals={signals}
          balances={balances}
          groups={groups}
          onOpenResearch={(t,s,pos,fb) =>
            setResearchTarget({ticker:t,sig:s,
              activePositions:pos,fallbackSpot:fb})}
        />
      )}

      {signalTab === 'signals' && (
      <>{/* ── All Tickers Table ── */}
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
            {['ALL','ACTIVE','WATCH'].map(f => (
              <button key={f}
                className={`${styles.filterPill} ${showFilter === f ? styles.filterActive : ''}`}
                onClick={() => setShowFilter(f)}>
                {f === 'ALL' ? 'All' : f === 'ACTIVE' ? '● Active' : '✦ New Trades'}
              </button>
            ))}
            <select
              className={styles.filterSelect}
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
            >
              <option value="readiness">Sort: 🟢 Readiness</option>
              <option value="conviction">Sort: Signal</option>
              <option value="ticker">Sort: Ticker</option>
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
                <th>Status</th>
                <th>Thesis</th>
                <th>Trade</th>
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
                          className={`${styles.tierDivider} ${styles[tierMeta.cls + 'Div'] ?? ''}`}>
                          <span className={styles.tierDividerLabel}>
                            {tierMeta.label}
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
      </>)}

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
  readinessTier,
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

  const rowCls = [
    styles.tableRow,
    isActive      ? styles.rowActive   : '',
    isOpportunity ? styles.rowOpp      : '',
    isBlocked && !isActive ? styles.rowBlocked : '',
  ].join(' ');

  return (
    <tr className={rowCls} onClick={() => onOpenResearch(ticker, sig, activePos, fallbackSpot)}>
      <td>
        <span className={styles.tableTicker}>{ticker}</span>
        {isActive && <span className={styles.activeDot} title="Active position">●</span>}
      </td>
      <td><span className={styles.bucketPill}>{bucket}</span></td>
      <td>
        {isOpportunity && <span className={styles.statusOpp}>🔥</span>}
        {isBlocked && !isActive && <span className={styles.statusBlock}>⚠</span>}
        {isActive && <span className={styles.statusActive}>Active</span>}
        {!isOpportunity && !isBlocked && !isActive && <span className={styles.statusWatch}>—</span>}
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
        (p.dte ?? 0) > 60
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
