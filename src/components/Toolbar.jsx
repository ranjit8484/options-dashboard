import styles from './Toolbar.module.css';

export function PlatformFilter({ plat, setPlat }) {
  return (
    <div className={styles.platBar}>
      <PillGroup>
        <Pill active={plat === 'ALL'} onClick={() => setPlat('ALL')} activeClass={styles.onAll}>All</Pill>
        <Pill active={plat === 'RH'}  onClick={() => setPlat('RH')}  activeClass={styles.onRh}>RH</Pill>
        <Pill active={plat === 'FID'} onClick={() => setPlat('FID')} activeClass={styles.onFid}>FID</Pill>
      </PillGroup>
    </div>
  );
}

const TRADE_TYPES = [
  { id: 'ALL',    label: 'All' },
  { id: 'NAKED',  label: 'Naked' },
  { id: 'LEAP',   label: 'LEAP' },
  { id: 'HEDGE',  label: 'Hedge' },
  { id: 'SPREAD', label: 'Spread' },
];

const DIRECTIONS = [
  { id: 'ALL',   label: 'All' },
  { id: 'CALLS', label: '📞 Calls' },
  { id: 'PUTS',  label: '📉 Puts' },
];

export function SortBar({
  sort, setSort,
  tradeType, setTradeType,
  direction, setDirection,
  count
}) {
  return (
    <div className={styles.sortBar}>
      <div className={styles.sortBarHeader}>
        <span className={styles.sortBarIcon}>📋</span>
        <span className={styles.sortBarTitle}>Active Positions</span>
        <span className={styles.sortBarCount}>{count}</span>
      </div>

      <div className={styles.sortBarFilters}>
      <div className={styles.filterRow}>
        <span className={styles.filterLabel}>Structure</span>
        <div className={styles.pills}>
          {TRADE_TYPES.map(t => (
            <button key={t.id}
              className={`${styles.pill} ${tradeType === t.id ? styles.pillActive : ''}`}
              onClick={() => setTradeType(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.filterRow}>
        <span className={styles.filterLabel}>Direction</span>
        <div className={styles.pills}>
          {DIRECTIONS.map(d => (
            <button key={d.id}
              className={`${styles.pill} ${direction === d.id ? styles.pillActive : ''}`}
              onClick={() => setDirection(d.id)}>
              {d.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.filterRow}>
        <span className={styles.filterLabel}>Sort</span>
        <div className={styles.pills}>
          {['status', 'expiry'].map(s => (
            <button key={s}
              className={`${styles.pill} ${sort === s ? styles.pillSort : ''}`}
              onClick={() => setSort(s)}>
              {s === 'status' ? 'Status' : 'Expiry'}
            </button>
          ))}
        </div>
      </div>
      </div>
    </div>
  );
}

function PillGroup({ children }) {
  return <div className={styles.pillGroup}>{children}</div>;
}

function Pill({ active, onClick, activeClass, children }) {
  return (
    <button
      className={`${styles.pill} ${active ? activeClass : ''}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
