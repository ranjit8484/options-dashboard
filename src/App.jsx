import { useEffect, useMemo, useState } from "react";
import { usePositions } from "./hooks/usePositions";
import { useSignals, getSignalCacheAge } from "./hooks/useSignals";
import { calcCollateral, calcStatus, estPnl, fk$, groupStatus } from "./lib/finance";
import { SummaryBar } from "./components/SummaryBar";
import { PlatformFilter, SortBar } from "./components/Toolbar";
import { TickerCard } from "./components/TickerCard";
import { ActionItems } from "./components/ActionItems";
import { CollateralPanel } from "./components/CollateralPanel";
import { RulesModal } from "./components/RulesModal";
import { TabNav } from "./components/TabNav";
import { SignalsPage } from "./pages/SignalsPage";
import { ClosedPage } from "./pages/ClosedPage";
import { ParametersModal } from "./components/ParametersModal";
import { loadParams } from "./hooks/useParams";
import { ResearchCard } from "./components/ResearchCard";
import styles from "./App.module.css";

const STATUS_ORDER = { danger: 0, watch: 1, safe: 2 };

export default function App() {
  // Public mode — hide positions, show signals only
  const urlParams = new URLSearchParams(window.location.search);
  const isPublic  = urlParams.get('view') === 'g2view';
  const isPrivate = urlParams.get('admin') === 'star';
  const isLocalhost = window.location.hostname === 'localhost';
  const isLocked  = !isPublic && !isPrivate && !isLocalhost;

  const posData = usePositions();
  const {
    groups, prices, getPrice, setPrice,
    loading, pricesLoading, error,
    lastUpdated, pricesUpdated,
    usingFallback, reload, refreshPrices,
    balances, watchlist, closed
  } = isPublic
    ? {
        groups: [],
        prices: posData.prices,
        getPrice: posData.getPrice,
        setPrice: posData.setPrice,
        loading: false,
        pricesLoading: posData.pricesLoading,
        error: null,
        lastUpdated: null,
        pricesUpdated: posData.pricesUpdated,
        usingFallback: false,
        reload: () => {},
        refreshPrices: posData.refreshPrices,
        balances: { rh: 0, fid: 0 },
        watchlist: posData.watchlist,
        closed: []
      }
    : posData;
  const [plat, setPlat] = useState("ALL");
  const [sort, setSort] = useState("status");
  const [tradeType, setTradeType] = useState("ALL");
  const [direction, setDirection] = useState("ALL");
  const [rulesOpen, setRulesOpen] = useState(false);
  const [paramsOpen, setParamsOpen] = useState(false);
  const [params, setParams] = useState(loadParams);
  const [researchTarget, setResearchTarget] = useState(null);
  const [activeTab, setActiveTab] = useState(
    isPublic ? 'signals' : 'active'
  );

  const tickers = useMemo(() => {
    const active = groups.map(g => g.t);
    const watch  = watchlist.map(w => w.ticker);
    return [...new Set([...active, ...watch])];
  }, [groups, watchlist]);
  const { signals, loading: signalsLoading, cacheTs, progress, refresh: refreshSignals } = useSignals(tickers);

  // Signal staleness — warn if > 6 hours old
  const [signalsStale, setSignalsStale] = useState(false);

  useEffect(() => {
    function checkStale() {
      const age = getSignalCacheAge();
      const SIX_HOURS = 6 * 60 * 60 * 1000;
      setSignalsStale(age === null || age > SIX_HOURS);
    }
    checkStale();
    // Re-check every 10 minutes
    const interval = setInterval(checkStale, 600000);
    return () => clearInterval(interval);
  }, [cacheTs]);

  useEffect(() => {
    if (tickers.length > 0) refreshPrices(tickers);
  }, [tickers.join(',')]);  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Filtered + sorted groups ──────────────────────────────────────
  const visible = useMemo(() => {
    let g = plat === "ALL" ? groups : groups.filter(g => g.pos.some(p => p.plat === plat));

    // Structure filter
    if (tradeType !== 'ALL') {
      // Pre-compute which tickers have LEAP positions
      // A short on the same ticker as a LEAP = hedge
      const leapTickers = new Set(
        groups.flatMap(g =>
          g.pos
            .filter(p => {
              const isLong = p.dir === 'lc' || p.dir === 'lp';
              const tt = (p.tradeType || p.lbl || '').toLowerCase();
              return isLong && (
                (p.dte ?? 0) > 45 ||
                tt.includes('long') ||
                tt.includes('leap') ||
                tt.includes('pmcc') ||
                tt.includes('pmcp')
              );
            })
            .map(() => g.t)
        )
      );

      g = g.map(grp => ({
        ...grp,
        pos: grp.pos.filter(p => {
          const tt = (p.tradeType || p.lbl || '').toLowerCase();
          const isShort = p.dir === 'sc' || p.dir === 'sp';
          const isLong  = p.dir === 'lc' || p.dir === 'lp';
          const isOnLeapTicker = leapTickers.has(grp.t);

          if (tradeType === 'NAKED')
            return isShort &&
              !isOnLeapTicker &&
              !tt.includes('hedge') &&
              !tt.includes('pmcc') &&
              !tt.includes('pmcp') &&
              !tt.includes('spread') &&
              !tt.includes('vertical');

          if (tradeType === 'LEAP')
            return isLong && (
              (p.dte ?? 0) > 45 ||
              tt.includes('long') ||
              tt.includes('leap') ||
              tt.includes('pmcc') ||
              tt.includes('pmcp') ||
              p.prem > 10
            );

          if (tradeType === 'HEDGE')
            return isShort && (
              isOnLeapTicker ||
              tt.includes('hedge') ||
              tt.includes('pmcc') ||
              tt.includes('pmcp')
            );

          if (tradeType === 'SPREAD')
            return tt.includes('spread') ||
                   tt.includes('vertical');

          return true;
        })
      })).filter(grp => grp.pos.length > 0);
    }

    // Direction filter
    if (direction !== 'ALL') {
      g = g.map(grp => ({
        ...grp,
        pos: grp.pos.filter(p =>
          direction === 'CALLS'
            ? p.dir === 'lc' || p.dir === 'sc'
            : p.dir === 'lp' || p.dir === 'sp'
        )
      })).filter(grp => grp.pos.length > 0);
    }

    return [...g].sort((a, b) => {
      if (sort === "status") {
        const sa = STATUS_ORDER[groupStatus(
          plat === "ALL" ? a.pos : a.pos.filter(p => p.plat === plat),
          getPrice(a.t)
        )];
        const sb = STATUS_ORDER[groupStatus(
          plat === "ALL" ? b.pos : b.pos.filter(p => p.plat === plat),
          getPrice(b.t)
        )];
        if (sa !== sb) return sa - sb;
      }
      const minDte = g => Math.min(...g.pos.filter(p => plat === "ALL" || p.plat === plat).map(p => p.dte ?? 9999));
      return minDte(a) - minDte(b);
    });
  }, [groups, plat, sort, tradeType, direction, prices]);

  // ── Summary stats ─────────────────────────────────────────────────
  const stats = useMemo(() => {
    const filteredPos = groups.flatMap(g =>
      plat === "ALL" ? g.pos : g.pos.filter(p => p.plat === plat)
    );

    let shortPnl = 0, danger = 0, exp10 = 0, totalColl = 0;

    groups.forEach(g => {
      const price = getPrice(g.t);
      const pos = plat === "ALL" ? g.pos : g.pos.filter(p => p.plat === plat);
      pos.forEach(p => {
        const { status } = calcStatus(p.dir, p.k, p.prem, price);
        if (status === "danger") danger++;
        if ((p.dte ?? 999) <= 10) exp10++;
        if (p.dir === "sc" || p.dir === "sp") shortPnl += estPnl(g.t, p.dir, p.k, p.dte ?? 0, p.prem, p.qty, price);
        totalColl += calcCollateral(p.dir, p.k, p.prem, p.qty, price);
      });
    });

    return [
      { label: "Positions",  value: filteredPos.length },
      { label: "Short P&L",  value: `${shortPnl >= 0 ? "+" : "-"}$${Math.round(Math.abs(shortPnl)).toLocaleString()}`, color: shortPnl >= 0 ? "var(--green)" : "var(--red)" },
      { label: "Exp ≤ 10d",  value: exp10,  color: exp10  > 0 ? "var(--amber)" : undefined },
      { label: "Danger",     value: danger, color: danger > 0 ? "var(--red)"   : undefined },
      { label: "Collateral", value: fk$(totalColl), sub: "est. margin" },
    ];
  }, [groups, plat, prices]);

  // ── Stamps ───────────────────────────────────────────────────────
  const fmtTime = (d) => d
    ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
      " · " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : "—";

  if (loading) return (
    <div className={styles.loading}>
      <div className={styles.loadingDot} />
      <span>Loading positions…</span>
    </div>
  );

  return (
    <div className={styles.app}>
      {isLocked && (
        <div style={{
          display:'flex', alignItems:'center', justifyContent:'center',
          height:'100vh', flexDirection:'column', gap:'12px',
          fontFamily:'monospace', color:'#666'
        }}>
          <div style={{fontSize:'24px'}}>🔒</div>
          <div style={{fontSize:'14px'}}>Access restricted</div>
        </div>
      )}
      {!isLocked && (<>
      {/* ── Header ── */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.logo}>G2</div>
          {!isPublic && (
            <div>
              <h1 className={styles.title}>Options Dashboard</h1>
              <div className={styles.stamp}>
                <span>Sheet {fmtTime(lastUpdated)}</span>
                {pricesUpdated && (
                  <span className={styles.pricesStamp}>
                    {pricesLoading ? "⟳ fetching…" : `Prices ${fmtTime(pricesUpdated)}`}
                  </span>
                )}
                {cacheTs && !signalsLoading && (
                  <span className={`${styles.signalsStamp} ${signalsStale ? styles.staleTime : ''}`}>
                    Signals {fmtTime(cacheTs)}
                    {signalsStale ? ' ⚠' : ''}
                  </span>
                )}
                {signalsLoading && (
                  <span className={styles.signalsStamp}>
                    ⟳ signals {progress.done}/{progress.total}
                  </span>
                )}
                {usingFallback && <span className={styles.fallbackBadge}>● demo data</span>}
                {error && <span className={styles.errorBadge} title={error}>⚠ sheet offline</span>}
              </div>
            </div>
          )}
        </div>
        <div className={styles.headerActions}>
          {!isPublic && (
            <>
              <button className={styles.rulesBtn} onClick={() => setParamsOpen(true)}>
                📊 Params
              </button>
              <button className={styles.rulesBtn} onClick={() => setRulesOpen(true)}>
                ⚙ Rules
              </button>
            </>
          )}
          <button
            className={`${styles.refreshBtn} ${signalsStale && !signalsLoading ? styles.refreshStale : ''}`}
            onClick={refreshSignals}
            disabled={signalsLoading}
            title={signalsStale
              ? "Signals are stale — click to refresh"
              : "Run Purple Cloud indicator across all timeframes"}>
            {signalsLoading
              ? `⟳ ${progress.done}/${progress.total}`
              : signalsStale
              ? "↻ Signals ⚠"
              : "↻ Signals"}
          </button>
          <button className={styles.refreshBtn} onClick={() => refreshPrices(tickers)} disabled={pricesLoading} title="Fetch live prices from Finnhub">
            {pricesLoading ? "⟳" : "↻"} Prices
          </button>
          {!isPublic && (
            <button className={styles.refreshBtn} onClick={reload} title="Reload positions from Google Sheets">
              ↻ Sheet
            </button>
          )}
        </div>
      </header>

      <TabNav activeTab={activeTab} setTab={setActiveTab} isPublic={isPublic} />

      {/* ── Platform filter — hidden on signals tab ── */}
      {activeTab !== "signals" && (
        <PlatformFilter plat={plat} setPlat={setPlat} />
      )}

      {activeTab === "active" && (
        <>
          {/* ── Summary ── */}
          <SummaryBar stats={stats} />

          {/* ── Action Items ── */}
          <ActionItems
            groups={groups}
            prices={prices}
            balances={balances}
            plat={plat}
          />

          {/* ── Collateral ── */}
          <CollateralPanel
            groups={groups}
            prices={prices}
            balances={balances}
            plat={plat}
            signals={signals}
            onOpenResearch={(ticker, sig, positions, fallbackSpot, initialTab) => {
              setResearchTarget({
                ticker,
                sig,
                activePositions: positions ?? groups.find(g => g.t === ticker)?.pos ?? [],
                fallbackSpot: fallbackSpot ?? prices?.[ticker] ?? null,
                initialTab: initialTab ?? 'why',
              });
            }}
          />

          {/* ── Active Positions sort bar ── */}
          <SortBar
            sort={sort} setSort={setSort}
            tradeType={tradeType} setTradeType={setTradeType}
            direction={direction} setDirection={setDirection}
            count={visible.reduce((s, g) => s + (plat === "ALL" ? g.pos : g.pos.filter(p => p.plat === plat)).length, 0)}
          />

          <div className={styles.cards}>
            {visible.map(g => (
              <TickerCard
                key={g.t}
                group={g}
                price={getPrice(g.t)}
                onPriceChange={setPrice}
                filterPlat={plat}
                tickerSignals={signals[g.t]}
              />
            ))}
            {visible.length === 0 && (
              <div className={styles.empty}>No positions for this platform.</div>
            )}
          </div>
        </>
      )}

      {activeTab === "signals" && (
        <SignalsPage
          groups={groups}
          watchlist={watchlist}
          signals={signals}
          signalsLoading={signalsLoading}
          progress={progress}
          onRefresh={refreshSignals}
          balances={balances}
          prices={prices}
          params={params}
          plat={plat}
          isPublic={isPublic}
          closed={closed}
        />
      )}

      {activeTab === "closed" && (
        <ClosedPage closed={closed} />
      )}

      {rulesOpen   && <RulesModal onClose={() => setRulesOpen(false)} />}
      {paramsOpen  && <ParametersModal
        onClose={() => setParamsOpen(false)}
        onSave={p => setParams(p)}
      />}
      {researchTarget && (
        <ResearchCard
          ticker={researchTarget.ticker}
          spot={prices?.[researchTarget.ticker] || researchTarget.fallbackSpot}
          sig={researchTarget.sig}
          activePositions={researchTarget.activePositions}
          balances={balances}
          allSignals={signals}
          initialTab={researchTarget.initialTab}
          onClose={() => setResearchTarget(null)}
        />
      )}
      </>)}
    </div>
  );
}
