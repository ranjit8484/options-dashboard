import { loadParams, riskPct } from '../hooks/useParams';
import { calcCollateral } from '../lib/finance';
import styles from './SizingCard.module.css';

function nakedCollateral(strike, price) {
  const otm = Math.max(0, strike - price);
  return Math.max((0.20 * price - otm) * 100, 0.10 * strike * 100);
}
function spreadCollateral(width) { return width * 100; }
function leapCollateral(prem)    { return prem * 100;  }

export function SizingCard({ ticker, strategy, price, positions, balances }) {
  if (!strategy || !balances) return null;
  const { conviction, variant, thesis } = strategy;
  const total = (balances.rh || 0) + (balances.fid || 0);
  if (total === 0) return null;

  const params  = loadParams();
  const maxRisk = total * (riskPct(conviction, params) ?? 0);
  if (maxRisk === 0) return null;

  const shortPos = positions?.find(p => p.dir === 'sc' || p.dir === 'sp');
  const longPos  = positions?.find(p => p.dir === 'lc' || p.dir === 'lp');
  const strike   = shortPos?.k ?? longPos?.k ?? price ?? 100;

  const rows = [];

  // Primary: naked — show first for full/high conviction
  if (variant === 'naked' || conviction === 'full' || conviction === 'high') {
    const coll = nakedCollateral(strike, price ?? strike);
    const max  = Math.floor(maxRisk / coll);
    const pct  = Math.round(coll / total * 100);
    const collStatus = pct >= params.blockTickerCollPct ? 'block'
                     : pct >= params.warnTickerCollPct  ? 'warn' : 'ok';
    rows.push({
      label:  `Sell Naked @ ~$${Math.round(strike * 0.95).toLocaleString()} strike`,
      sublabel: 'OTM target — adjust strike to your thesis',
      coll, max,
      collPct: pct,
      collStatus,
      isPrimary: true,
      note: max === 0 ? '⚠ exceeds collateral limit' :
            collStatus === 'block' ? `⚠ ${pct}% of account — exceeds ${params.blockTickerCollPct}% block limit` :
            collStatus === 'warn'  ? `⚠ ${pct}% of account — exceeds ${params.warnTickerCollPct}% warn threshold` :
            null,
    });
  }

  // Fallback: credit spreads
  if (variant === 'credit' || conviction !== 'none') {
    [50, 25, 10].forEach(width => {
      const coll = spreadCollateral(width);
      const max  = Math.floor(maxRisk / coll);
      if (max > 0) rows.push({
        label: `Credit Spread $${width} wide`,
        sublabel: `Max loss $${(width*100).toLocaleString()}/contract`,
        coll, max, collPct: null, collStatus: 'ok', isPrimary: false, note: null,
      });
    });
  }

  // LEAP
  if (variant === 'leap' && longPos) {
    const coll = leapCollateral(longPos.prem);
    const max  = Math.floor(maxRisk / coll);
    rows.push({
      label: `LEAP @ $${strike}`,
      sublabel: `${longPos.exp ?? ''} · paid $${longPos.prem?.toFixed(2)}`,
      coll, max, collPct: null, collStatus: 'ok', isPrimary: true,
      note: max === 0 ? '⚠ consider smaller spread instead' : null,
    });
  }

  // Iron Condor
  if (variant === 'condor') {
    [50, 25].forEach(width => {
      const coll = spreadCollateral(width);
      const max  = Math.floor(maxRisk / coll);
      if (max > 0) rows.push({
        label: `Iron Condor $${width} wings`,
        sublabel: 'Sell both sides',
        coll, max, collPct: null, collStatus: 'ok', isPrimary: false, note: null,
      });
    });
  }

  if (rows.length === 0) return null;

  const riskPctVal = Math.round(riskPct(conviction, params) * 100);

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <span className={styles.icon}>💰</span>
        <span className={styles.title}>Sizing — {ticker}</span>
        <span className={styles.total}>
          RH ${(balances.rh||0).toLocaleString()} +
          FID ${(balances.fid||0).toLocaleString()} =
          ${total.toLocaleString()}
        </span>
      </div>
      <div className={styles.conviction}>
        {thesis} · Max risk ({riskPctVal}%): ${Math.round(maxRisk).toLocaleString()}
      </div>
      <div className={styles.rows}>
        {rows.map((row, i) => (
          <div key={i} className={`${styles.row}
            ${row.max === 0 ? styles.zero : ''}
            ${row.isPrimary ? styles.primary : ''}
            ${row.collStatus === 'block' ? styles.collBlock :
              row.collStatus === 'warn'  ? styles.collWarn  : ''}
          `}>
            <div className={styles.rowTop}>
              <span className={styles.rowLabel}>{row.label}</span>
              {row.isPrimary && <span className={styles.primaryBadge}>★ primary</span>}
              <span className={styles.rowColl}>
                ~${Math.round(row.coll).toLocaleString()}/contract
                {row.collPct !== null ? ` (${row.collPct}%)` : ''}
              </span>
              <span className={`${styles.rowMax}
                ${row.max > 0 ? styles.ok : styles.none}`}>
                {row.max > 0
                  ? `→ ${row.max} contract${row.max > 1 ? 's' : ''} ✓`
                  : '→ 0 contracts'}
              </span>
            </div>
            {row.sublabel && (
              <div className={styles.rowSub}>{row.sublabel}</div>
            )}
            {row.note && (
              <div className={`${styles.note}
                ${row.collStatus === 'block' ? styles.noteBlock :
                  row.collStatus === 'warn'  ? styles.noteWarn  : ''}`}>
                {row.note}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
