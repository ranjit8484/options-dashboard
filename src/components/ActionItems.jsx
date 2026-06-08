import { useMemo, useState } from "react";
import { calcStatus, f$ } from "../lib/finance";
import { PlatBadge } from "./Badge";
import styles from "./ActionItems.module.css";

// ── Trade Management Panel ────────────────────────────
function TradeManagement({ groups, prices, balances, plat }) {
  const [open, setOpen] = useState(true);

  const items = useMemo(() => {
    const list = [];

    // Filter groups/positions by platform
    const filteredGroups = plat === 'ALL' ? groups : groups.map(g => ({
      ...g, pos: g.pos.filter(p => p.plat === plat)
    })).filter(g => g.pos.length > 0);

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
              plat: p.plat,
              text: `${g.t} ${p.lbl} expires in ${dte}d — DANGER, `+
                `${diff > 0 ? `ITM ${f$(Math.abs(diff))}` : `OTM ${f$(Math.abs(diff))}`} past breakeven`,
              action: 'Close or roll TODAY' });
          } else if (isShort && status === 'watch') {
            list.push({ priority: 1, icon: '🟠', urgency: 'watch',
              plat: p.plat,
              text: `${g.t} ${p.lbl} expires in ${dte}d — approaching strike`,
              action: 'Decide: close, roll, or let expire' });
          } else if (isShort) {
            list.push({ priority: 2, icon: '✅', urgency: 'safe',
              plat: p.plat,
              text: `${g.t} ${p.lbl} expires in ${dte}d — OTM, on track`,
              action: 'Let expire or close for remaining credit' });
          }
        } else if (dte <= 7 && isShort) {
          if (status === 'danger') {
            list.push({ priority: 0, icon: '🔴', urgency: 'danger',
              plat: p.plat,
              text: `${g.t} ${p.lbl} — ${dte}d left, DANGER`,
              action: 'Roll out now — do not wait' });
          } else if (status === 'watch') {
            list.push({ priority: 1, icon: '🟠', urgency: 'watch',
              plat: p.plat,
              text: `${g.t} ${p.lbl} — ${dte}d left, WATCH`,
              action: 'Plan roll by end of week' });
          }
        } else if (status === 'danger' && dte > 7) {
          list.push({ priority: 1, icon: '⚠️', urgency: 'danger',
            plat: p.plat,
            text: `${g.t} ${p.lbl} — DANGER with ${dte}d remaining`,
            action: 'Review and roll strike' });
        }
      });
    });

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
                <div className={styles.itemText}>
                  {item.text}
                  {item.plat && (
                    <PlatBadge platform={item.plat} />
                  )}
                </div>
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

// ── Main export ───────────────────────────────────────
export function ActionItems({ groups, prices, balances, plat }) {
  return (
    <TradeManagement groups={groups} prices={prices} balances={balances} plat={plat} />
  );
}
