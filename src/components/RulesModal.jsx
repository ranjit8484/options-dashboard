import { createPortal } from 'react-dom';
import styles from './RulesModal.module.css';

const RULES = [
  {
    section: 'Framework',
    rows: [
      { col1: 'W (Weekly)',  col2: 'Macro context — only blocks at ±2 (🚀/☄️)' },
      { col1: 'D (Daily)',   col2: 'Primary trend — main signal driver' },
      { col1: '4H',          col2: 'Entry timing — RSI zones + MACD cross' },
      { col1: '1H',          col2: 'Fine-tune entry — MACD cross confirmation' },
    ]
  },
  {
    section: 'Ichimoku Signals',
    rows: [
      { col1: '🚀 xs=+2', col2: 'Price above cloud + cloud bullish + TK bull' },
      { col1: '▲ xs=+1', col2: 'Price above cloud (partial conditions)' },
      { col1: '▽ xs=-1', col2: 'Price below cloud (partial conditions)' },
      { col1: '☄️ xs=-2', col2: 'Price below cloud + cloud bearish + TK bear' },
    ]
  },
  {
    section: 'Premium Harvest (Sell)',
    rows: [
      { col1: 'Bull Premium ★', col2: 'W🚀+D🚀 + 4H RSI 63-76, no bear cross → Sell Put NAKED' },
      { col1: 'Bull Premium',   col2: 'D bullish + 4H RSI 63-76, W confirms/neutral → Put Credit Spread' },
      { col1: 'Bear Premium ★', col2: 'W☄️+D☄️ + 4H RSI 24-37, no bull cross → Sell Call NAKED' },
      { col1: 'Bear Premium',   col2: 'D bearish + 4H RSI 24-37, W confirms/neutral → Call Credit Spread' },
      { col1: 'Iron Condor',    col2: 'Price in Ichimoku cloud + RSI 38-62 → Sell both sides' },
    ]
  },
  {
    section: 'Directional Entry',
    rows: [
      { col1: 'Long Call',   col2: 'W🚀+D🚀 + 4H MACD bull cross RSI 35-65 → Buy LEAP Call' },
      { col1: 'Bull Spread', col2: 'D bullish + 4H bull cross, W neutral → Put Credit Spread' },
      { col1: 'Long Put',    col2: 'W☄️+D☄️ + 4H MACD bear cross RSI 35-65 → Buy LEAP Put' },
      { col1: 'Bear Spread', col2: 'D bearish + 4H bear cross, W neutral → Call Credit Spread' },
    ]
  },
  {
    section: 'Setup / Wait',
    rows: [
      { col1: 'Bull Setup',    col2: 'D bullish but 4H not triggered yet → Watch, small Put Credit Spread' },
      { col1: 'Bear Setup',    col2: 'D bearish but 4H not triggered yet → Watch, small Call Credit Spread' },
      { col1: 'Conflicted ↑', col2: 'W☄️ blocks D bullish → Small Bull Put Spread only' },
      { col1: 'Conflicted ↓', col2: 'W🚀 blocks D bearish → Small Bear Call Spread only' },
      { col1: 'No Signal',    col2: 'D unclear or W=D conflict with no direction → Stay out' },
    ]
  },
  {
    section: 'Exit',
    rows: [
      { col1: 'Exit Long',  col2: '4H RSI > 76 + MACD bear cross, OR RSI > 83 → Close longs' },
      { col1: 'Exit Short', col2: '4H RSI < 24 + MACD bull cross, OR RSI < 17 → Close shorts' },
    ]
  },
  {
    section: 'Sizing (Risk Appetite 9/10)',
    rows: [
      { col1: 'Full (★ Naked)', col2: '8% of total account per position' },
      { col1: 'High (Credit Spread, W confirms)', col2: '5% of total account per position' },
      { col1: 'Medium (Setup, W neutral)', col2: '3% of total account per position' },
      { col1: 'Low (Conflicted, Condor)', col2: '2% of total account per position' },
    ]
  },
];

export function RulesModal({ onClose }) {
  return createPortal(
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>⚙ G2 Signal Rules</span>
          <span className={styles.sub}>Last updated: May 28 2026 · Edit in finance.js</span>
          <button className={styles.close} onClick={onClose}>✕</button>
        </div>
        <div className={styles.body}>
          {RULES.map(({ section, rows }) => (
            <div key={section} className={styles.section}>
              <div className={styles.sectionHead}>{section}</div>
              {rows.map((row, i) => (
                <div key={i} className={styles.row}>
                  <span className={styles.col1}>{row.col1}</span>
                  <span className={styles.col2}>{row.col2}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className={styles.footer}>
          To change any rule: discuss in claude.ai chat → update finance.js calcEntry() or calcStrategy()
        </div>
      </div>
    </div>,
    document.body
  );
}
