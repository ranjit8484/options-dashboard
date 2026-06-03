import { useMemo } from 'react';
import { calcBackdrop } from '../hooks/useFundamentals';
import styles from './EntryChecklist.module.css';

// ── Individual check item ─────────────────────────────────────────
function CheckItem({ status, label, detail }) {
  const icon = status === 'green'  ? '●'
             : status === 'amber'  ? '◐'
             : status === 'red'    ? '○'
             : '·';
  return (
    <div className={`${styles.checkItem} ${styles[`check_${status}`]}`}>
      <span className={styles.checkIcon}>{icon}</span>
      <span className={styles.checkLabel}>{label}</span>
      <span className={styles.checkDetail}>{detail}</span>
    </div>
  );
}

// ── Master conditions (same for all trade types) ──────────────────
function masterChecks(sig, fundamentals, spot) {
  const W  = sig?.W;
  const D  = sig?.D;
  const checks = [];

  // 1. W Direction
  const wXs = W?.xs ?? 0;
  if (wXs === 2 || wXs === -2) {
    checks.push({ key:'wDir', status:'green',
      label:'W Direction',
      detail: wXs >= 2 ? '🚀 Strong bull confirmed' : '☄️ Strong bear confirmed' });
  } else if (wXs === 1 || wXs === -1) {
    checks.push({ key:'wDir', status:'amber',
      label:'W Direction',
      detail: wXs === 1 ? '▲ Weak bull — spread only' : '▽ Weak bear — spread only' });
  } else {
    checks.push({ key:'wDir', status:'red',
      label:'W Direction',
      detail:'· Neutral — no trade this week' });
  }

  // 2. D Confirms W
  const dXs = D?.xs ?? 0;
  const wBull = wXs >= 1;
  const wBear = wXs <= -1;
  const dMatch   = (wBull && dXs >= 1) || (wBear && dXs <= -1);
  const dOppose  = (wBull && dXs <= -1) || (wBear && dXs >= 1);
  if (dMatch) {
    checks.push({ key:'dConf', status:'green',
      label:'D Confirms',
      detail:`${dXs>=2?'🚀':dXs===1?'▲':dXs===-1?'▽':'☄️'} Matches weekly direction` });
  } else if (dOppose) {
    checks.push({ key:'dConf', status:'red',
      label:'D Confirms',
      detail:'Opposes weekly — no trade' });
  } else {
    checks.push({ key:'dConf', status:'amber',
      label:'D Confirms',
      detail:'Neutral — wait for D to align' });
  }

  // 3. Extension check
  const kijunDist = D?.kijunDist ?? 0;
  const absKijun  = Math.abs(kijunDist);
  if (absKijun > 25) {
    checks.push({ key:'ext', status:'red',
      label:'Extension',
      detail:`${kijunDist>0?'+':''}${kijunDist.toFixed(1)}% from Kijun — extreme, no trade` });
  } else if (absKijun > 15) {
    checks.push({ key:'ext', status:'amber',
      label:'Extension',
      detail:`${kijunDist>0?'+':''}${kijunDist.toFixed(1)}% from Kijun — reduce size 50%` });
  } else {
    checks.push({ key:'ext', status:'green',
      label:'Extension',
      detail:`${kijunDist>0?'+':''}${kijunDist.toFixed(1)}% from Kijun ✓` });
  }

  // 4. Fundamental backdrop
  if (fundamentals) {
    const isBull = wBull;
    const bd = calcBackdrop(fundamentals, isBull, spot);
    if (bd) {
      if (bd.rating === 'AGAINST') {
        checks.push({ key:'backdrop', status:'red',
          label:'Backdrop',
          detail:'🚫 Fundamentals against this trade' });
      } else if (bd.rating === 'CAUTION') {
        checks.push({ key:'backdrop', status:'amber',
          label:'Backdrop',
          detail:'⚠ Caution — reduce size' });
      } else {
        checks.push({ key:'backdrop', status:'green',
          label:'Backdrop',
          detail:`${bd.rating === 'STRONG' ? '✅ Strong'
            : bd.rating === 'SUPPORTS' ? '✓ Supports'
            : '○ Neutral'} for this trade` });
      }
    }
  }

  // 5. No major event (earnings check)
  if (fundamentals?.nextEarnings) {
    const dte = fundamentals.nextEarnings.dte;
    if (dte <= 14) {
      checks.push({ key:'event', status:'red',
        label:'No Event',
        detail:`Earnings in ${dte}d — too close, no trade` });
    } else if (dte <= 21) {
      checks.push({ key:'event', status:'amber',
        label:'No Event',
        detail:`Earnings in ${dte}d — spread only, size down` });
    } else {
      checks.push({ key:'event', status:'green',
        label:'No Event',
        detail:`Earnings ${dte}d away ✓` });
    }
  } else {
    checks.push({ key:'event', status:'green',
      label:'No Event',
      detail:'No earnings nearby ✓' });
  }

  // 6. Good entry day (Mon/Tue/Wed)
  const day = new Date().getDay();
  if (day >= 1 && day <= 3) {
    const dayName = ['','Mon','Tue','Wed'][day];
    checks.push({ key:'day', status:'green',
      label:'Entry Day',
      detail:`${dayName} — good entry window ✓` });
  } else {
    const dayName = day === 4 ? 'Thursday' : day === 5 ? 'Friday' : 'Weekend';
    checks.push({ key:'day', status:'amber',
      label:'Entry Day',
      detail:`${dayName} — better to wait until Monday` });
  }

  return checks;
}

// ── Naked-specific checks ─────────────────────────────────────────
function nakedChecks(sig, spot, rec) {
  const checks = [];
  const W  = sig?.W;
  const D  = sig?.D;
  const h4 = sig?.['4H'];
  const wXs    = W?.xs ?? 0;
  const dXs    = D?.xs ?? 0;
  const isBull = wXs >= 1;
  const h4Xs   = h4?.xs ?? 0;
  const h4Since = h4?.since ?? 0;

  // Full conviction required
  const fullBull = wXs >= 2 && dXs >= 2;
  const fullBear = wXs <= -2 && dXs <= -2;
  if (fullBull || fullBear) {
    checks.push({ key:'conviction', status:'green',
      label:'Full Conviction',
      detail:'W★★ + D★★ — naked appropriate ✓' });
  } else {
    checks.push({ key:'conviction', status:'red',
      label:'Full Conviction',
      detail:'Need W★★ + D★★ for naked — use spread instead' });
  }

  // 4H bounce timing
  if (isBull && h4Xs <= -1 && h4Since <= 6) {
    checks.push({ key:'timing', status:'green',
      label:'4H Timing',
      detail:'▽ Short dip in uptrend — ideal entry ✓' });
  } else if (!isBull && h4Xs >= 1 && h4Since <= 6) {
    checks.push({ key:'timing', status:'green',
      label:'4H Timing',
      detail:'▲ Short bounce in downtrend — ideal entry ✓' });
  } else if (h4Since > 8) {
    checks.push({ key:'timing', status:'amber',
      label:'4H Timing',
      detail:`4H extended ${h4Since} candles — wait for reversal` });
  } else {
    checks.push({ key:'timing', status:'green',
      label:'4H Timing',
      detail:'Fresh 4H signal — enter now ✓' });
  }

  // Buffer check
  const buffer = rec ? parseFloat(rec.buffer) : 0;
  if (buffer >= 8) {
    checks.push({ key:'buffer', status:'green',
      label:'Buffer > 5%',
      detail:`${buffer}% buffer ✓` });
  } else if (buffer >= 5) {
    checks.push({ key:'buffer', status:'amber',
      label:'Buffer > 5%',
      detail:`${buffer}% — tight, size down` });
  } else {
    checks.push({ key:'buffer', status:'red',
      label:'Buffer > 5%',
      detail:`${buffer}% — too close, no trade` });
  }

  return checks;
}

// ── Spread-specific checks ────────────────────────────────────────
function spreadChecks(sig, spot, rec) {
  const checks = [];
  const W  = sig?.W;
  const h4 = sig?.['4H'];
  const h1 = sig?.['1H'];
  const wXs    = W?.xs ?? 0;
  const isBull = wXs >= 1;
  const h4Xs   = h4?.xs ?? 0;
  const h4Since = h4?.since ?? 0;
  const h1Xs   = h1?.xs ?? 0;

  // 4H timing
  if (isBull && h4Xs <= -1 && h4Since <= 6) {
    checks.push({ key:'h4', status:'green',
      label:'4H Timing',
      detail:`▽ Bounce in uptrend (${h4Since} candles) — wait for 1H ✓` });
  } else if (!isBull && h4Xs >= 1 && h4Since <= 6) {
    checks.push({ key:'h4', status:'green',
      label:'4H Timing',
      detail:`▲ Bounce in downtrend (${h4Since} candles) — wait for 1H ✓` });
  } else if ((isBull && h4Xs >= 1 && h4Since > 8)
          || (!isBull && h4Xs <= -1 && h4Since > 8)) {
    checks.push({ key:'h4', status:'red',
      label:'4H Timing',
      detail:`Extended ${h4Since} candles — wait for counter-move` });
  } else if (h4Since <= 3) {
    checks.push({ key:'h4', status:'green',
      label:'4H Timing',
      detail:'Fresh 4H reversal — enter now ✓' });
  } else {
    checks.push({ key:'h4', status:'amber',
      label:'4H Timing',
      detail:'Neutral — check again tomorrow' });
  }

  // 1H confirmation
  if ((isBull && h1Xs >= 1) || (!isBull && h1Xs <= -1)) {
    checks.push({ key:'h1', status:'green',
      label:'1H Confirms',
      detail:`${h1Xs >= 1 ? '▲' : '▽'} Aligned with trade direction ✓` });
  } else if (h1Xs === 0) {
    checks.push({ key:'h1', status:'amber',
      label:'1H Confirms',
      detail:'Neutral — wait for 1H to turn' });
  } else {
    checks.push({ key:'h1', status:'red',
      label:'1H Confirms',
      detail:'Opposing — wait for 1H reversal' });
  }

  // Buffer check
  const buffer = rec ? parseFloat(rec.buffer) : 0;
  if (buffer >= 10) {
    checks.push({ key:'buffer', status:'green',
      label:'Buffer > 8%',
      detail:`${buffer}% ✓` });
  } else if (buffer >= 8) {
    checks.push({ key:'buffer', status:'amber',
      label:'Buffer > 8%',
      detail:`${buffer}% — acceptable, size down` });
  } else {
    checks.push({ key:'buffer', status:'red',
      label:'Buffer > 8%',
      detail:`${buffer}% — too close, skip` });
  }

  // Premium ratio
  if (rec && rec.premiumTotal && rec.maxLoss) {
    const ratio = rec.premiumTotal / (rec.premiumTotal + rec.maxLoss) * 100;
    if (ratio >= 20) {
      checks.push({ key:'premium', status:'green',
        label:'Premium > 20%',
        detail:`${ratio.toFixed(0)}% of spread width ✓` });
    } else if (ratio >= 15) {
      checks.push({ key:'premium', status:'amber',
        label:'Premium > 20%',
        detail:`${ratio.toFixed(0)}% — low, size down` });
    } else {
      checks.push({ key:'premium', status:'red',
        label:'Premium > 20%',
        detail:`${ratio.toFixed(0)}% — not worth the risk` });
    }
  }

  return checks;
}

// ── LEAP-specific checks ──────────────────────────────────────────
function leapChecks(sig, spot, fundamentals) {
  const checks = [];
  const W  = sig?.W;
  const D  = sig?.D;
  const wXs = W?.xs ?? 0;
  const dXs = D?.xs ?? 0;

  // Strong conviction required
  const strong = Math.abs(wXs) >= 2 && Math.abs(dXs) >= 1
    && ((wXs >= 2 && dXs >= 1) || (wXs <= -2 && dXs <= -1));
  if (strong) {
    checks.push({ key:'conviction', status:'green',
      label:'W Conviction',
      detail:'W★★ confirmed — LEAP appropriate ✓' });
  } else if (Math.abs(wXs) >= 1) {
    checks.push({ key:'conviction', status:'amber',
      label:'W Conviction',
      detail:'W not fully confirmed — LEAP is higher risk' });
  } else {
    checks.push({ key:'conviction', status:'red',
      label:'W Conviction',
      detail:'W neutral — no LEAP entry' });
  }

  // 90+ DTE available
  checks.push({ key:'dte', status:'green',
    label:'90+ DTE',
    detail:'Monthly expiries available ✓' });

  // Not near 52-week extreme
  if (fundamentals?.range52 && spot) {
    const { high, low } = fundamentals.range52;
    const range = high - low;
    const pos   = range > 0 ? (spot - low) / range : 0.5;
    const isBull = wXs >= 1;
    if (!isBull && pos > 0.90) {
      checks.push({ key:'range', status:'red',
        label:'Not At Extreme',
        detail:'Near 52-week high — expensive put LEAP' });
    } else if (isBull && pos < 0.10) {
      checks.push({ key:'range', status:'red',
        label:'Not At Extreme',
        detail:'Near 52-week low — expensive call LEAP' });
    } else {
      checks.push({ key:'range', status:'green',
        label:'Not At Extreme',
        detail:`At ${Math.round(pos*100)}% of 52-week range ✓` });
    }
  }

  // IV not extreme
  checks.push({ key:'iv', status:'green',
    label:'IV Reasonable',
    detail:'Check IV before buying — avoid IV > 60%' });

  return checks;
}

// ── Summary banner ────────────────────────────────────────────────
function SummaryBanner({ masterReady, tradeType, tradeReady, redCount, amberCount }) {
  if (!masterReady) {
    return (
      <div className={styles.bannerRed}>
        <span className={styles.bannerIcon}>○</span>
        <div className={styles.bannerText}>
          <span className={styles.bannerTitle}>
            NOT READY — {redCount} condition{redCount!==1?'s':''} blocking
          </span>
          <span className={styles.bannerSub}>
            Check items above · come back when all green
          </span>
        </div>
      </div>
    );
  }
  if (!tradeReady) {
    return (
      <div className={styles.bannerAmber}>
        <span className={styles.bannerIcon}>◐</span>
        <div className={styles.bannerText}>
          <span className={styles.bannerTitle}>
            WAITING — {tradeType} conditions not met
          </span>
          <span className={styles.bannerSub}>
            Master conditions clear · check timing below
          </span>
        </div>
      </div>
    );
  }
  if (amberCount > 0) {
    return (
      <div className={styles.bannerAmber}>
        <span className={styles.bannerIcon}>◐</span>
        <div className={styles.bannerText}>
          <span className={styles.bannerTitle}>
            PROCEED WITH CAUTION — size down 50%
          </span>
          <span className={styles.bannerSub}>
            {amberCount} amber condition{amberCount!==1?'s':''} · reduce contracts, wider stops
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className={styles.bannerGreen}>
      <span className={styles.bannerIcon}>●</span>
      <div className={styles.bannerText}>
        <span className={styles.bannerTitle}>🟢 READY TO TRADE</span>
        <span className={styles.bannerSub}>All conditions met · choose strikes below</span>
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────
export function EntryChecklist({
  sig, spot, fundamentals,
  tradeType,   // 'naked' | 'spread' | 'leap'
  firstRec,    // first recommendation from buildRec
}) {
  const master = useMemo(() =>
    masterChecks(sig, fundamentals, spot),
    [sig, fundamentals, spot]
  );

  const specific = useMemo(() => {
    if (tradeType === 'naked')  return nakedChecks(sig, spot, firstRec);
    if (tradeType === 'spread') return spreadChecks(sig, spot, firstRec);
    if (tradeType === 'leap')   return leapChecks(sig, spot, fundamentals);
    return [];
  }, [tradeType, sig, spot, firstRec, fundamentals]);

  const masterRed   = master.filter(c => c.status==='red').length;
  const masterAmber = master.filter(c => c.status==='amber').length;
  const specRed     = specific.filter(c => c.status==='red').length;
  const specAmber   = specific.filter(c => c.status==='amber').length;

  const masterReady = masterRed === 0;
  const tradeReady  = masterReady && specRed === 0;
  const totalAmber  = masterAmber + specAmber;

  return (
    <div className={styles.checklist}>

      {/* Summary banner at top */}
      <SummaryBanner
        masterReady={masterReady}
        tradeType={tradeType}
        tradeReady={tradeReady}
        redCount={masterRed + specRed}
        amberCount={totalAmber}
      />

      {/* Master conditions */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>
          <span>MASTER CONDITIONS</span>
        </div>
        {master.map(c => (
          <CheckItem key={c.key} status={c.status}
            label={c.label} detail={c.detail} />
        ))}
      </div>

      {/* Trade-specific conditions */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>
          <span>
            {tradeType === 'naked'  ? 'NAKED CONDITIONS'
            :tradeType === 'spread' ? 'SPREAD CONDITIONS'
            : 'LEAP CONDITIONS'}
          </span>
          {tradeReady
            ? <span className={styles.sectionGo}>● GO</span>
            : specRed > 0
            ? <span className={styles.sectionStop}>○ WAIT</span>
            : <span className={styles.sectionCaution}>◐ CAUTION</span>
          }
        </div>
        {specific.map(c => (
          <CheckItem key={c.key} status={c.status}
            label={c.label} detail={c.detail} />
        ))}
      </div>

    </div>
  );
}

// Export readiness check for gating strikes
export function useChecklistReady(sig, spot, fundamentals, tradeType, firstRec) {
  return useMemo(() => {
    const master   = masterChecks(sig, fundamentals, spot);
    const specific = tradeType === 'naked'
      ? nakedChecks(sig, spot, firstRec)
      : tradeType === 'spread'
      ? spreadChecks(sig, spot, firstRec)
      : leapChecks(sig, spot, fundamentals);
    const redCount   = [...master, ...specific].filter(c => c.status === 'red').length;
    const amberCount = [...master, ...specific].filter(c => c.status === 'amber').length;
    return {
      ready:   redCount === 0,
      caution: redCount === 0 && amberCount > 0,
      blocked: redCount > 0,
      redCount,
      amberCount,
    };
  }, [sig, spot, fundamentals, tradeType, firstRec]);
}
