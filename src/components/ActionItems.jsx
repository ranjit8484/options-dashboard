import { useMemo, useState } from "react";
import { calcCollateral, calcStatus, f$ } from "../lib/finance";
import { loadParams, tickerCollStatus } from "../hooks/useParams";
import styles from "./ActionItems.module.css";

function daysSince(dateStr) {
  if (!dateStr) return null;
  try {
    return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  } catch { return null; }
}

// ── Trade Management Panel ────────────────────────────
function TradeManagement({ groups, prices, balances, plat }) {
  const [open, setOpen] = useState(true);
  const params = loadParams();

  const items = useMemo(() => {
    const list = [];

    // Filter groups/positions by platform
    const filteredGroups = plat === 'ALL' ? groups : groups.map(g => ({
      ...g, pos: g.pos.filter(p => p.plat === plat)
    })).filter(g => g.pos.length > 0);

    const totalAccount = plat === 'RH'
      ? (balances?.rh || 0)
      : plat === 'FID'
      ? (balances?.fid || 0)
      : (balances?.rh || 0) + (balances?.fid || 0);

    // Position alerts
    filteredGroups.forEach(g => {
      const price = prices[g.t] ?? 100;
      g.pos.forEach(p => {
        const { status, diff } = calcStatus(p.dir, p.k, p.prem, price);
        const isShort = p.dir === 'sc' || p.dir === 'sp';
        const dte = p.dte ?? 999;

        if (dte <= 3) {
          if (status === 'danger') {
            list.push({ priority: 0, icon: '🔴', urgency: 'danger',
              text: `${g.t} ${p.lbl} expires in ${dte}d — DANGER, `+
                `${diff > 0 ? `ITM ${f$(Math.abs(diff))}` : `OTM ${f$(Math.abs(diff))}`} past breakeven`,
              action: 'Close or roll TODAY' });
          } else if (isShort && status === 'watch') {
            list.push({ priority: 1, icon: '🟠', urgency: 'watch',
              text: `${g.t} ${p.lbl} expires in ${dte}d — approaching strike`,
              action: 'Decide: close, roll, or let expire' });
          } else if (isShort) {
            list.push({ priority: 2, icon: '✅', urgency: 'safe',
              text: `${g.t} ${p.lbl} expires in ${dte}d — OTM, on track`,
              action: 'Let expire or close for remaining credit' });
          }
        } else if (dte <= 7 && isShort) {
          if (status === 'danger') {
            list.push({ priority: 0, icon: '🔴', urgency: 'danger',
              text: `${g.t} ${p.lbl} — ${dte}d left, DANGER`,
              action: 'Roll out now — do not wait' });
          } else if (status === 'watch') {
            list.push({ priority: 1, icon: '🟠', urgency: 'watch',
              text: `${g.t} ${p.lbl} — ${dte}d left, WATCH`,
              action: 'Plan roll by end of week' });
          }
        } else if (status === 'danger' && dte > 7) {
          list.push({ priority: 1, icon: '⚠️', urgency: 'danger',
            text: `${g.t} ${p.lbl} — DANGER with ${dte}d remaining`,
            action: 'Review and roll strike' });
        }
      });
    });

    // Collateral concentration
    if (totalAccount > 0) {
      filteredGroups.forEach(g => {
        const price = prices[g.t] ?? 100;
        const coll = g.pos.reduce(
          (s,p) => s + calcCollateral(p.dir,p.k,p.prem,p.qty,price), 0
        );
        const status = tickerCollStatus(coll, totalAccount, params);
        const pct = Math.round(coll / totalAccount * 100);
        if (status === 'block') {
          list.push({ priority: 0, icon: '🔴', urgency: 'danger',
            text: `${g.t} collateral = ${pct}% of account — exceeds ${params.blockTickerCollPct}% limit`,
            action: 'Reduce position size immediately' });
        } else if (status === 'warn') {
          list.push({ priority: 1, icon: '🟡', urgency: 'watch',
            text: `${g.t} collateral = ${pct}% of account — approaching limit`,
            action: 'Monitor — reduce on next roll' });
        }
      });
    }

    // Naked count per platform
    const nakedCount = filteredGroups.filter(g =>
      g.pos.some(p => p.dir === 'sc' || p.dir === 'sp')
    ).length;
    const platLabel = plat === 'ALL' ? 'total' : plat;
    if (nakedCount > params.maxNakedPositions) {
      list.push({ priority: 1, icon: '⚠️', urgency: 'watch',
        text: `${nakedCount} naked/short tickers on ${platLabel} — exceeds max ${params.maxNakedPositions}`,
        action: 'Close or convert some to spreads' });
    }

    return list.sort((a,b) => a.priority - b.priority);
  }, [groups, prices, balances, plat]);

  const urgentCount = items.filter(i =>
    i.urgency === 'danger' || i.urgency === 'watch'
  ).length;

  return (
    <div className={styles.panel}>
      <button className={styles.header} onClick={() => setOpen(o => !o)}>
        <span className={styles.icon}>⚡</span>
        <span className={styles.title}>Trade Management</span>
        <span className={`${styles.count} ${urgentCount > 0 ? styles.countUrgent : ''}`}>
          {items.length}
        </span>
        <span className={styles.chevron}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className={styles.body}>
          {items.length === 0 ? (
            <div className={styles.empty}>✅ No urgent trade actions right now.</div>
          ) : items.map((item, i) => (
            <div key={i} className={`${styles.item} ${styles[item.urgency]}`}>
              <span className={styles.itemIcon}>{item.icon}</span>
              <div className={styles.itemBody}>
                <div className={styles.itemText}>{item.text}</div>
                <span className={`${styles.itemAction} ${styles[`action_${item.urgency}`]}`}>
                  {item.action}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── LEAP Management Panel ─────────────────────────────
function LeapManagement({ groups, prices, closed, plat }) {
  const [open, setOpen] = useState(false);
  const params = loadParams();

  const items = useMemo(() => {
    const list = [];

    const filteredGroups = plat === 'ALL' ? groups : groups.map(g => ({
      ...g, pos: g.pos.filter(p => p.plat === plat)
    })).filter(g => g.pos.length > 0);

    filteredGroups.forEach(g => {
      const leaps = g.pos.filter(p =>
        (p.dir === 'lc' || p.dir === 'lp') && (p.dte ?? 0) > 60
      );
      if (!leaps.length) return;

      // Map short positions to LEAPs by index
      // If fewer shorts than LEAPs, later LEAPs are uncovered
      const allShorts = g.pos.filter(p =>
        p.dir === 'sc' || p.dir === 'sp'
      );

      leaps.forEach((leap, leapIdx) => {
        const activeHedge = allShorts[leapIdx] ?? null;

        let harvested = 0;
        const leapOpenDate = leap.openDate ? new Date(leap.openDate) : null;
        if (closed && leapOpenDate) {
          closed.forEach(c => {
            if ((c.ticker||'').toUpperCase() !== g.t.toUpperCase()) return;
            const cd = c.closeDate ? new Date(c.closeDate) : null;
            if (!cd || cd < leapOpenDate) return;
            const isHedgeTrade = (c.tradeType||'')
              .toLowerCase().match(/hedge|pmcc|pmcp|covered|naked/);
            const credit = parseFloat(c.exitCredit || 0);
            if (isHedgeTrade && credit > 0) harvested += credit * 100;
          });
        }

        const leapCost  = leap.prem * 100 * (leap.qty || 1);
        const offsetPct = leapCost > 0 ? Math.round(harvested/leapCost*100) : 0;
        const remaining = Math.max(0, leapCost - harvested);
        const leapDir   = leap.dir === 'lc' ? 'Call' : 'Put';
        const stale     = leap.openDate ? daysSince(leap.openDate) : null;

        const costStr = `Cost $${Math.round(leapCost).toLocaleString()}`;
        const harvStr = `Harvested $${Math.round(harvested).toLocaleString()} (${offsetPct}%)`;
        const remStr  = `Remaining $${Math.round(remaining).toLocaleString()}`;

        if (activeHedge) {
          const hedgeExp = activeHedge.exp;
          const hedgeDte = activeHedge?.dte ?? 999;
          list.push({ priority: 2, icon: '✅', urgency: 'safe',
            ticker: g.t, leap,
            text: `${g.t} ${leap.k} Long ${leapDir} — hedge active${hedgeExp ? ` (${hedgeExp})` : ''}`,
            sub: `${costStr} · ${harvStr} · ${remStr}`,
            action: (() => {
              if (hedgeDte <= 5) return `Hedge expires in ${hedgeDte}d — prepare next sale`;
              if (hedgeDte <= 14) return `Hedge expires in ${hedgeDte}d — plan next cycle`;
              return offsetPct >= 50
                ? '50%+ offset achieved ✓'
                : `On track — ${offsetPct}% offset, review near expiry`;
            })() });
        } else {
          const isStale = (stale ?? 0) > params.leapHedgeWarnDays;
          list.push({ priority: isStale ? 0 : 1,
            icon: isStale ? '🔴' : '🟡',
            urgency: isStale ? 'danger' : 'watch',
            ticker: g.t, leap,
            text: `${g.t} ${leap.k} Long ${leapDir} — NO active hedge`+
              (stale !== null ? ` · ${stale}d since open` : ''),
            sub: `${costStr} · ${harvStr} · ${remStr}`,
            action: isStale
              ? `${stale}d without hedge — sell a ${leap.dir === 'lc' ? 'call' : 'put'} now`
              : `Consider selling short-term ${leap.dir === 'lc' ? 'call' : 'put'}` });
        }
      });
    });

    return list.sort((a,b) => a.priority - b.priority);
  }, [groups, prices, closed, plat]);

  const urgentCount = items.filter(i => i.urgency !== 'safe').length;
  const allGood     = items.length > 0 && items.every(i => i.urgency === 'safe');

  return (
    <div className={`${styles.panel} ${styles.leapPanel}`}>
      <button className={styles.header} onClick={() => setOpen(o => !o)}>
        <span className={styles.icon}>📈</span>
        <span className={styles.title}>LEAP Management</span>
        <span className={`${styles.count} ${urgentCount > 0 ? styles.countUrgent : styles.countGood}`}>
          {items.length}
        </span>
        {allGood && <span className={styles.allGood}>all hedged ✓</span>}
        <span className={styles.chevron}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className={styles.body}>
          {items.length === 0 ? (
            <div className={styles.empty}>No LEAP positions found.</div>
          ) : items.map((item, i) => (
            <div key={i} className={`${styles.leapItem} ${styles[item.urgency]}`}>
              <div className={styles.leapItemHeader}>
                <span className={styles.itemIcon}>{item.icon}</span>
                <span className={styles.leapTicker}>{item.ticker}</span>
                <span className={styles.leapTitle}>{item.text}</span>
                <span className={`${styles.leapAction} ${styles[`action_${item.urgency}`]}`}>
                  {item.action}
                </span>
              </div>
              {item.sub && (
                <div className={styles.leapSub}>
                  {item.sub.split(' · ').map((part, j) => {
                    const [label, ...val] = part.split(' ');
                    return (
                      <div key={j} className={styles.leapMetric}>
                        <span className={styles.leapMetricLabel}>{label}</span>
                        <span className={styles.leapMetricVal}>{val.join(' ')}</span>
                      </div>
                    );
                  })}
                  {(() => {
                    const match = item.sub.match(/\((\d+)%\)/);
                    const pct = match ? parseInt(match[1]) : 0;
                    return (
                      <div className={styles.leapProgressWrap}>
                        <div className={styles.leapProgressBar}>
                          <div className={styles.leapProgress}
                            style={{
                              width: `${Math.min(pct, 100)}%`,
                              background: pct >= 50 ? 'var(--green)'
                                : pct >= 25 ? 'var(--amber)' : 'var(--red)'
                            }}
                          />
                        </div>
                        <span className={styles.leapProgressPct}>{pct}% offset</span>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main export — renders both panels ─────────────────
export function ActionItems({ groups, prices, balances, closed, plat }) {
  return (
    <>
      <TradeManagement groups={groups} prices={prices} balances={balances} plat={plat} />
      <LeapManagement  groups={groups} prices={prices} closed={closed} plat={plat} />
    </>
  );
}
