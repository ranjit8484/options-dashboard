import { useMemo, useState } from 'react';
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Cell
} from 'recharts';
import styles from './ClosedPage.module.css';

function normalizePlatform(val) {
  if (!val) return '';
  const s = String(val).trim().toUpperCase();
  if (s === 'RH' || s.includes('ROBIN')) return 'RH';
  if (s === 'FID' || s.includes('FIDEL')) return 'FID';
  return s;
}

function fmt$(n) {
  if (n === null || n === undefined || n === '') return '—';
  const num = parseFloat(n);
  if (isNaN(num)) return '—';
  return (num >= 0 ? '+' : '-') + '$' + Math.abs(Math.round(num)).toLocaleString();
}

function fmtPct(n) {
  if (n === null || n === undefined || n === '') return '—';
  const num = parseFloat(n);
  if (isNaN(num)) return '—';
  const pct = Math.abs(num) <= 1 ? num * 100 : num;
  return (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%';
}

function fmtDate(d) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
  } catch { return String(d); }
}

function SlicerBar({ dateRange, setDateRange, allTickers, filterTickers,
  setFilterTickers, allTypes, filterTypes, setFilterTypes,
  filterPlat, setFilterPlat, filterPnl, setFilterPnl }) {

  function toggleItem(arr, setArr, val) {
    setArr(prev => prev.includes(val) ? prev.filter(x => x !== val) : [...prev, val]);
  }

  return (
    <div className={styles.slicerBar}>
      <div className={styles.slicerGroup}>
        <span className={styles.slicerLabel}>Period</span>
        <div className={styles.pills}>
          {['7d','30d','90d','ytd','all'].map(d => (
            <button key={d}
              className={`${styles.pill} ${dateRange === d ? styles.pillActive : ''}`}
              onClick={() => setDateRange(d)}>
              {d === 'all' ? 'All' : d === 'ytd' ? 'YTD' : d}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.slicerGroup}>
        <span className={styles.slicerLabel}>Platform</span>
        <div className={styles.pills}>
          {['ALL','RH','FID'].map(p => (
            <button key={p}
              className={`${styles.pill} ${filterPlat === p ? styles.pillActive : ''}`}
              onClick={() => setFilterPlat(p)}>
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.slicerGroup}>
        <span className={styles.slicerLabel}>P&L</span>
        <div className={styles.pills}>
          {[['all','All'],['winners','Winners ✅'],['losers','Losers 🔴']].map(([val,lbl]) => (
            <button key={val}
              className={`${styles.pill} ${filterPnl === val ? styles.pillActive : ''}`}
              onClick={() => setFilterPnl(val)}>
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {allTickers.length > 0 && (
        <div className={styles.slicerGroup}>
          <span className={styles.slicerLabel}>
            Tickers {filterTickers.length > 0 ? `(${filterTickers.length})` : ''}
          </span>
          <div className={styles.pills}>
            {allTickers.map(t => (
              <button key={t}
                className={`${styles.pill} ${filterTickers.includes(t) ? styles.pillTicker : ''}`}
                onClick={() => toggleItem(allTickers, setFilterTickers, t)}>
                {t}
              </button>
            ))}
            {filterTickers.length > 0 && (
              <button className={styles.clearBtn}
                onClick={() => setFilterTickers([])}>✕ clear</button>
            )}
          </div>
        </div>
      )}

      {allTypes.length > 0 && (
        <div className={styles.slicerGroup}>
          <span className={styles.slicerLabel}>
            Type {filterTypes.length > 0 ? `(${filterTypes.length})` : ''}
          </span>
          <div className={styles.pills}>
            {allTypes.map(t => (
              <button key={t}
                className={`${styles.pill} ${filterTypes.includes(t) ? styles.pillActive : ''}`}
                onClick={() => toggleItem(allTypes, setFilterTypes, t)}>
                {t}
              </button>
            ))}
            {filterTypes.length > 0 && (
              <button className={styles.clearBtn}
                onClick={() => setFilterTypes([])}>✕ clear</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ChartsRow({ stats, filteredClosed }) {
  if (!stats) return null;

  const equityData = useMemo(() => {
    const sorted = [...filteredClosed]
      .filter(r => r.realizedPnl !== '' && r.closeDate)
      .sort((a,b) => new Date(a.closeDate) - new Date(b.closeDate));
    let cum = 0;
    return sorted.map(r => {
      cum += parseFloat(r.realizedPnl || 0);
      return {
        date: new Date(r.closeDate).toLocaleDateString('en-US',
          { month:'short', day:'numeric' }),
        pnl: Math.round(cum),
      };
    });
  }, [filteredClosed]);

  const tickerData = stats.byTicker.slice(0, 10).map(([t, d]) => ({
    ticker: t,
    pnl: Math.round(d.pnl),
  }));

  const typeData = stats.byType.map(([type, d]) => ({
    type: type.length > 10 ? type.slice(0,10)+'…' : type,
    winRate: Math.round(d.wins / d.count * 100),
    trades: d.count,
  }));

  const finalPnl = equityData.length ? equityData[equityData.length - 1].pnl : 0;

  return (
    <div className={styles.chartsRow}>
      <div className={styles.chartPanel}>
        <div className={styles.chartHead}>
          Equity Curve
          <span className={`${styles.chartSub} ${finalPnl >= 0 ? styles.pos : styles.neg}`}>
            {finalPnl >= 0 ? '+' : ''}${Math.abs(finalPnl).toLocaleString()} total
          </span>
        </div>
        <ResponsiveContainer width="100%" height={140}>
          <LineChart data={equityData}
            margin={{ top:4, right:8, bottom:4, left:8 }}>
            <XAxis dataKey="date" tick={{fontSize:9, fill:'var(--text3)'}}
              tickLine={false} axisLine={false}
              interval={Math.floor(equityData.length / 4)} />
            <YAxis hide />
            <Tooltip
              contentStyle={{
                background:'var(--bg2)', border:'1px solid var(--border)',
                borderRadius:6, fontSize:11
              }}
              formatter={(v) => [`$${v.toLocaleString()}`, 'Cumulative P&L']}
            />
            <Line type="monotone" dataKey="pnl" dot={false} strokeWidth={2}
              stroke={finalPnl >= 0 ? 'var(--green)' : 'var(--red)'}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className={styles.chartPanel}>
        <div className={styles.chartHead}>P&L by Ticker</div>
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={tickerData}
            margin={{ top:4, right:8, bottom:4, left:8 }}>
            <XAxis dataKey="ticker"
              tick={{fontSize:9, fill:'var(--text3)'}}
              tickLine={false} axisLine={false} />
            <YAxis hide />
            <Tooltip
              contentStyle={{
                background:'var(--bg2)', border:'1px solid var(--border)',
                borderRadius:6, fontSize:11
              }}
              formatter={(v) => [`$${v.toLocaleString()}`, 'P&L']}
            />
            <Bar dataKey="pnl" radius={[3,3,0,0]}>
              {tickerData.map((entry, i) => (
                <Cell key={i}
                  fill={entry.pnl >= 0 ? 'var(--green)' : 'var(--red)'}
                  opacity={0.8}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className={styles.chartPanel}>
        <div className={styles.chartHead}>Win Rate by Type</div>
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={typeData} layout="vertical"
            margin={{ top:4, right:8, bottom:4, left:4 }}>
            <XAxis type="number" domain={[0,100]} hide />
            <YAxis type="category" dataKey="type"
              tick={{fontSize:9, fill:'var(--text3)'}}
              tickLine={false} axisLine={false} width={80}
              tickFormatter={(v) => v.length > 12 ? v.slice(0,12) : v} />
            <Tooltip
              contentStyle={{
                background:'var(--bg2)', border:'1px solid var(--border)',
                borderRadius:6, fontSize:11
              }}
              formatter={(v, n, p) =>
                [`${v}% (${p.payload.trades} trades)`, 'Win Rate']}
            />
            <Bar dataKey="winRate" radius={[0,3,3,0]}>
              {typeData.map((entry, i) => (
                <Cell key={i}
                  fill={entry.winRate >= 60
                    ? 'var(--green)'
                    : entry.winRate >= 45
                    ? 'var(--amber)'
                    : 'var(--red)'}
                  opacity={0.8}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function InsightsPanel({ stats, normalizedClosed }) {
  if (!stats || stats.total === 0) return null;

  const biggestLoss = normalizedClosed
    .filter(r => r.realizedPnl)
    .sort((a,b) => parseFloat(a.realizedPnl) - parseFloat(b.realizedPnl))[0];

  const avgDte = (function() {
    const withDte = normalizedClosed.filter(r => r.openDate && r.closeDate);
    if (!withDte.length) return null;
    const avg = withDte.reduce((s,r) => {
      return s + (new Date(r.closeDate) - new Date(r.openDate)) / 86400000;
    }, 0) / withDte.length;
    return Math.round(avg);
  })();

  const totalPremium = normalizedClosed
    .filter(r => parseFloat(r.credit || 0) > 0)
    .reduce((s,r) => s + parseFloat(r.credit || 0) * 100, 0);

  const sndk = normalizedClosed.filter(r => r.ticker === 'SNDK');
  const sndkPnl = sndk.reduce((s,r) => s + parseFloat(r.realizedPnl || 0), 0);

  const insights = [];

  if (biggestLoss) insights.push({
    icon: '🔴',
    text: `Biggest single loss: ${fmt$(biggestLoss.realizedPnl)} on ${biggestLoss.ticker} (${biggestLoss.tradeType})`,
    color: 'var(--red)',
  });

  if (stats.avgLoss && Math.abs(stats.avgLoss) > Math.abs(stats.avgWin) * 1.5) insights.push({
    icon: '⚠️',
    text: `Loss/win ratio is ${(Math.abs(stats.avgLoss)/Math.abs(stats.avgWin)).toFixed(1)}x — losses are significantly larger than wins. Sizing is the priority.`,
    color: 'var(--amber)',
  });

  if (avgDte !== null) insights.push({
    icon: '📅',
    text: `Average hold time: ${avgDte} days. ${avgDte < 5 ? 'Very short — are you closing too early?' : avgDte > 30 ? 'Long holds — theta decay may be working against you' : 'Healthy 2-4 week range'}`,
    color: 'var(--text2)',
  });

  if (sndk.length > 0) insights.push({
    icon: sndkPnl >= 0 ? '✅' : '🔴',
    text: `SNDK total P&L: ${fmt$(sndkPnl)} across ${sndk.length} trades (${Math.round(sndk.filter(r=>parseFloat(r.realizedPnl)>0).length/sndk.length*100)}% win rate)`,
    color: sndkPnl >= 0 ? 'var(--green)' : 'var(--red)',
  });

  if (totalPremium > 0) insights.push({
    icon: '💰',
    text: `Total premium collected: $${Math.round(totalPremium).toLocaleString()}. Realized P&L: ${fmt$(stats.totalPnl)}. Kept ${Math.round(stats.totalPnl/totalPremium*100)}% of collected premium.`,
    color: 'var(--text2)',
  });

  if (!insights.length) return null;

  return (
    <div className={styles.insightsPanel}>
      <div className={styles.panelHead}>Key Insights</div>
      {insights.map((ins, i) => (
        <div key={i} className={styles.insightRow}>
          <span className={styles.insightIcon}>{ins.icon}</span>
          <span className={styles.insightText}
            style={{ color: ins.color }}>{ins.text}</span>
        </div>
      ))}
    </div>
  );
}

export function ClosedPage({ closed }) {
  const [dateRange, setDateRange] = useState('all');
  const [filterTickers, setFilterTickers] = useState([]);
  const [filterTypes, setFilterTypes]     = useState([]);
  const [filterPlat, setFilterPlat]       = useState('ALL');
  const [filterPnl, setFilterPnl]         = useState('all');

  const normalizedClosed = useMemo(() =>
    closed.map(r => ({
      ...r,
      platform: normalizePlatform(r.platform),
      roi: typeof r.roi === 'number' && Math.abs(r.roi) <= 1 ? r.roi * 100 : r.roi,
    })),
  [closed]);

  const allTickers = useMemo(() =>
    [...new Set(normalizedClosed.map(r => r.ticker).filter(Boolean))].sort(),
  [normalizedClosed]);

  const allTypes = useMemo(() =>
    [...new Set(normalizedClosed.map(r => r.tradeType).filter(Boolean))].sort(),
  [normalizedClosed]);

  const filteredClosed = useMemo(() => {
    const now = new Date();
    return normalizedClosed.filter(r => {
      if (dateRange !== 'all') {
        const d = new Date(r.closeDate);
        if (dateRange === 'ytd') {
          if (d.getFullYear() !== now.getFullYear()) return false;
        } else {
          const days = { '7d':7, '30d':30, '90d':90 }[dateRange];
          const cutoff = new Date(now - days * 86400000);
          if (d < cutoff) return false;
        }
      }
      if (filterTickers.length > 0 && !filterTickers.includes(r.ticker)) return false;
      if (filterTypes.length > 0 && !filterTypes.includes(r.tradeType)) return false;
      if (filterPlat !== 'ALL' && r.platform !== filterPlat) return false;
      if (filterPnl === 'winners' && parseFloat(r.realizedPnl) <= 0) return false;
      if (filterPnl === 'losers'  && parseFloat(r.realizedPnl) >= 0) return false;
      return true;
    });
  }, [normalizedClosed, dateRange, filterTickers, filterTypes, filterPlat, filterPnl]);

  const stats = useMemo(() => {
    const trades = filteredClosed.filter(r => r.realizedPnl !== '' && r.realizedPnl !== null);
    if (!trades.length) return null;

    const total = trades.length;
    const winners = trades.filter(r => parseFloat(r.realizedPnl) > 0);
    const losers  = trades.filter(r => parseFloat(r.realizedPnl) < 0);
    const totalPnl   = trades.reduce((s, r) => s + parseFloat(r.realizedPnl || 0), 0);
    const avgWin  = winners.length ? winners.reduce((s,r) => s + parseFloat(r.realizedPnl), 0) / winners.length : 0;
    const avgLoss = losers.length  ? losers.reduce((s,r)  => s + parseFloat(r.realizedPnl), 0) / losers.length  : 0;
    const winRate = total ? Math.round((winners.length / total) * 100) : 0;
    const expectancy = total ? totalPnl / total : 0;

    const byTicker = {};
    trades.forEach(r => {
      if (!r.ticker) return;
      if (!byTicker[r.ticker]) byTicker[r.ticker] = { pnl: 0, count: 0, wins: 0 };
      byTicker[r.ticker].pnl   += parseFloat(r.realizedPnl || 0);
      byTicker[r.ticker].count += 1;
      if (parseFloat(r.realizedPnl) > 0) byTicker[r.ticker].wins += 1;
    });

    const byType = {};
    trades.forEach(r => {
      const key = r.tradeType || 'Unknown';
      if (!byType[key]) byType[key] = { pnl: 0, count: 0, wins: 0 };
      byType[key].pnl   += parseFloat(r.realizedPnl || 0);
      byType[key].count += 1;
      if (parseFloat(r.realizedPnl) > 0) byType[key].wins += 1;
    });

    return {
      total, totalPnl, winRate, avgWin, avgLoss, expectancy,
      byTicker: Object.entries(byTicker).sort((a,b) => b[1].pnl - a[1].pnl),
      byType:   Object.entries(byType).sort((a,b) => b[1].pnl - a[1].pnl),
      recent:   [...trades].sort((a,b) => new Date(b.closeDate) - new Date(a.closeDate)).slice(0, 20),
    };
  }, [filteredClosed]);

  if (!closed.length) return (
    <div className={styles.empty}>No closed trades found. Check your "Closed" sheet tab.</div>
  );

  return (
    <div className={styles.page}>

      <SlicerBar
        dateRange={dateRange} setDateRange={setDateRange}
        allTickers={allTickers} filterTickers={filterTickers}
        setFilterTickers={setFilterTickers}
        allTypes={allTypes} filterTypes={filterTypes}
        setFilterTypes={setFilterTypes}
        filterPlat={filterPlat} setFilterPlat={setFilterPlat}
        filterPnl={filterPnl} setFilterPnl={setFilterPnl}
      />

      {!stats ? (
        <div className={styles.empty}>No matching trades for this filter.</div>
      ) : (
        <>
          <div className={styles.summaryGrid}>
            <StatCard label="Total Trades"  value={stats.total} />
            <StatCard label="Win Rate"      value={`${stats.winRate}%`}
              color={stats.winRate >= 60 ? 'var(--green)' : stats.winRate >= 45 ? 'var(--amber)' : 'var(--red)'} />
            <StatCard label="Total P&L"     value={fmt$(stats.totalPnl)}
              color={stats.totalPnl >= 0 ? 'var(--green)' : 'var(--red)'} />
            <StatCard label="Expectancy"    value={fmt$(stats.expectancy) + '/trade'}
              color={stats.expectancy >= 0 ? 'var(--green)' : 'var(--red)'} />
            <StatCard label="Avg Winner"    value={fmt$(stats.avgWin)}  color="var(--green)" />
            <StatCard label="Avg Loser"     value={fmt$(stats.avgLoss)} color="var(--red)"   />
          </div>

          <ChartsRow stats={stats} filteredClosed={filteredClosed} />

          {stats.avgLoss !== 0 && Math.abs(stats.avgLoss) > Math.abs(stats.avgWin) * 1.5 && (
            <div className={styles.ratioWarn}>
              ⚠ Avg loss (${Math.abs(Math.round(stats.avgLoss)).toLocaleString()}) is{' '}
              {(Math.abs(stats.avgLoss) / Math.abs(stats.avgWin)).toFixed(1)}× your avg win.
              Sizing discipline is the priority.
            </div>
          )}

          <div className={styles.twoCol}>
            <div className={styles.panel}>
              <div className={styles.panelHead}>P&L by Ticker</div>
              <table className={styles.table}>
                <thead>
                  <tr><th>Ticker</th><th>Trades</th><th>Win%</th><th>P&L</th></tr>
                </thead>
                <tbody>
                  {stats.byTicker.map(([ticker, d]) => (
                    <tr key={ticker}>
                      <td className={styles.mono}>{ticker}</td>
                      <td className={styles.mono}>{d.count}</td>
                      <td className={styles.mono}>{Math.round(d.wins/d.count*100)}%</td>
                      <td>
                        <div className={styles.tdMetric}>
                          <span className={styles.tdLbl}>P&L</span>
                          <span className={`${styles.tdVal} ${d.pnl >= 0 ? styles.pos : styles.neg}`}>
                            {fmt$(d.pnl)}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={styles.panel}>
              <div className={styles.panelHead}>P&L by Trade Type</div>
              <table className={styles.table}>
                <thead>
                  <tr><th>Type</th><th>Trades</th><th>Win%</th><th>P&L</th></tr>
                </thead>
                <tbody>
                  {stats.byType.map(([type, d]) => (
                    <tr key={type}>
                      <td>{type}</td>
                      <td className={styles.mono}>{d.count}</td>
                      <td className={styles.mono}>{Math.round(d.wins/d.count*100)}%</td>
                      <td className={`${styles.mono} ${d.pnl >= 0 ? styles.pos : styles.neg}`}>
                        {fmt$(d.pnl)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className={styles.panel}>
            <div className={styles.panelHead}>Recent Trades (last 20)</div>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Date</th><th>Ticker</th><th>Type</th>
                  <th>P&L</th><th>ROI</th><th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {stats.recent.map((r, i) => (
                  <tr key={i} className={styles.tradeRow}>
                    <td className={styles.tdDate}>
                      {fmtDate(r.closeDate)}
                    </td>
                    <td>
                      <span className={styles.tdTicker}>{r.ticker}</span>
                    </td>
                    <td>
                      <span className={styles.tdType}>{r.tradeType}</span>
                    </td>
                    <td>
                      <div className={styles.tdMetric}>
                        <span className={styles.tdLbl}>P&L</span>
                        <span className={`${styles.tdVal} ${parseFloat(r.realizedPnl) >= 0 ? styles.pos : styles.neg}`}>
                          {fmt$(r.realizedPnl)}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className={styles.tdMetric}>
                        <span className={styles.tdLbl}>ROI</span>
                        <span className={`${styles.tdVal} ${parseFloat(r.roi) >= 0 ? styles.pos : styles.neg}`}>
                          {fmtPct(r.roi)}
                        </span>
                      </div>
                    </td>
                    <td className={styles.tdNotes}>{r.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <InsightsPanel stats={stats} normalizedClosed={normalizedClosed} />
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div className={styles.statCard}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statVal} style={color ? { color } : undefined}>{value}</div>
    </div>
  );
}
