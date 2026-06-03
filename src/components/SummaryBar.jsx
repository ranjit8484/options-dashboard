import styles from './SummaryBar.module.css';

export function SummaryBar({ stats }) {
  return (
    <div className={styles.grid}>
      {stats.map(({ label, value, sub, color }) => (
        <div key={label} className={styles.card}>
          <div className={styles.label}>{label}</div>
          <div className={styles.value} style={color ? { color } : undefined}>{value}</div>
          {sub && <div className={styles.sub}>{sub}</div>}
        </div>
      ))}
    </div>
  );
}
