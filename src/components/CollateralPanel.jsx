import { useMemo, useState } from "react";
import { calcCollateral, fk$ } from "../lib/finance";
import { loadParams } from "../hooks/useParams";
import styles from "./CollateralPanel.module.css";

export function CollateralPanel({ groups, prices, balances, plat }) {
  const [open, setOpen] = useState(false);
  const params = loadParams();

  const { tickers, grand, totalAccount, warnings, warnCount } = useMemo(() => {
    // Filter groups by platform
    const filteredGroups = plat === 'ALL' ? groups : groups.map(g => ({
      ...g,
      pos: g.pos.filter(p => p.plat === plat)
    })).filter(g => g.pos.length > 0);

    // Total account value for the selected platform
    const totalAccount = plat === 'RH'
      ? (balances?.rh || 0)
      : plat === 'FID'
      ? (balances?.fid || 0)
      : (balances?.rh || 0) + (balances?.fid || 0);

    const map = {};
    let grand = 0;
    filteredGroups.forEach(g => {
      const price = prices[g.t] ?? 100;
      const tc = g.pos.reduce(
        (s, p) => s + calcCollateral(p.dir, p.k, p.prem, p.qty, price), 0
      );
      map[g.t] = tc;
      grand += tc;
    });

    const tickers = Object.entries(map)
      .map(([t, c]) => {
        const pctOfAccount = totalAccount > 0
          ? Math.round(c / totalAccount * 100) : 0;
        const pctOfColl = grand > 0
          ? Math.round(c / grand * 100) : 0;
        const warnPct  = params.warnTickerCollPct  ?? 20;
        const blockPct = params.blockTickerCollPct ?? 50;
        const status = pctOfAccount >= blockPct ? 'block'
                     : pctOfAccount >= warnPct  ? 'warn' : 'ok';
        return { t, c, pctOfAccount, pctOfColl, status };
      })
      .sort((a, b) => b.c - a.c);

    const warnings = tickers
      .filter(x => x.status !== 'ok')
      .map(x => x.status === 'block'
        ? `${x.t} is ${x.pctOfAccount}% of account — exceeds ${params.blockTickerCollPct}% limit`
        : `${x.t} is ${x.pctOfAccount}% of account — approaching limit`
      );

    const warnCount = tickers.filter(x => x.status !== 'ok').length;

    return { tickers, grand, totalAccount, warnings, warnCount };
  }, [groups, prices, balances, plat, params]);

  const platLabel = plat === 'RH' ? 'RH' : plat === 'FID' ? 'FID' : 'All';

  return (
    <div className={styles.panel}>
      <button className={styles.header} onClick={() => setOpen(o => !o)}>
        <span className={styles.icon}>🔐</span>
        <span className={styles.title}>
          Collateral & Concentration
          {plat !== 'ALL' && <span className={styles.platTag}>{platLabel}</span>}
        </span>
        {warnCount > 0 ? (
          <span className={styles.warnBadge}>{warnCount}</span>
        ) : (
          <span className={styles.okBadge}>✓</span>
        )}
        <span className={styles.totalCompact}>
          {fk$(grand)}
          {totalAccount > 0 &&
            ` · ${Math.round(grand/totalAccount*100)}%`}
        </span>
        <span className={styles.chevron}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className={styles.body}>
          {tickers.map(({ t, c, pctOfAccount, pctOfColl, status }) => (
            <div key={t} className={styles.row}>
              <span className={styles.ticker}>{t}</span>
              <div className={styles.barWrap}>
                <div
                  className={`${styles.bar} ${
                    status === 'block' ? styles.barOver :
                    status === 'warn'  ? styles.barWarn : styles.barOk
                  }`}
                  style={{ width: `${Math.min(pctOfAccount * 2, 100)}%` }}
                />
              </div>
              <span className={styles.amt}>{fk$(c)}</span>
              <span className={`${styles.pct} ${
                status === 'block' ? styles.pctBlock :
                status === 'warn'  ? styles.pctWarn  : ''
              }`}>
                {pctOfAccount}%
                {status !== 'ok' && ' ⚠'}
              </span>
            </div>
          ))}
          <div className={styles.note}>
            % shown vs {plat === 'ALL' ? 'total account (RH+FID)' : `${plat} account`} ·
            Warn at {params.warnTickerCollPct ?? 20}% · Block at {params.blockTickerCollPct ?? 50}%
          </div>
          {warnings.length > 0 ? (
            <div className={styles.warn}>⚠ {warnings.join(' · ')}</div>
          ) : (
            <div className={styles.ok}>
              ✅ All tickers within concentration limits
              {totalAccount > 0 && ` (account: $${Math.round(totalAccount).toLocaleString()})`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
