import { useState } from 'react';
import { createPortal } from 'react-dom';
import { DEFAULT_PARAMS, loadParams, saveParams } from '../hooks/useParams';
import styles from './ParametersModal.module.css';

const REGIME_LABELS = {
  1: 'Normal — full premium selling allowed',
  2: 'Elevated — reduce size 50%',
  3: 'Expansion — tighten deltas, reduce exposure',
  4: 'Squeeze/Abnormal — NO naked premium selling',
};

export function ParametersModal({ onClose, onSave }) {
  const [params, setParams] = useState(loadParams);

  function set(key, val) {
    setParams(prev => ({ ...prev, [key]: val }));
  }

  function handleSave() {
    saveParams(params);
    onSave(params);
    onClose();
  }

  function handleReset() {
    setParams({ ...DEFAULT_PARAMS });
  }

  return createPortal(
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>

        <div className={styles.header}>
          <span className={styles.title}>⚙ Trading Parameters</span>
          <span className={styles.sub}>Risk appetite: 9/10 Aggressive · Changes saved to browser</span>
          <button className={styles.close} onClick={onClose}>✕</button>
        </div>

        <div className={styles.body}>

          {/* Position Limits */}
          <Section title="Position Limits">
            <Field label="Max total active tickers"
              hint="Tickers with open positions, not legs"
              value={params.maxTotalTickers}
              onChange={v => set('maxTotalTickers', v)} min={1} max={30} />
            <Field label="Max positions per bucket"
              hint="Sector concentration limit"
              value={params.maxPerBucket}
              onChange={v => set('maxPerBucket', v)} min={1} max={10} />
            <Field label="Max naked positions total"
              hint="Naked requires active daily management"
              value={params.maxNakedPositions}
              onChange={v => set('maxNakedPositions', v)} min={1} max={10} />
          </Section>

          {/* Risk Per Trade */}
          <Section title="Risk Per Trade (% of total account)">
            <Field label="Full conviction — Naked ★"
              hint="W🚀+D🚀 aligned, premium zone"
              value={params.riskFull}
              onChange={v => set('riskFull', v)} min={1} max={25} suffix="%" />
            <Field label="High conviction — Credit Spread"
              hint="D strong, W confirms"
              value={params.riskHigh}
              onChange={v => set('riskHigh', v)} min={1} max={20} suffix="%" />
            <Field label="Medium conviction — Setup/Watch"
              hint="D bullish, timing not triggered"
              value={params.riskMedium}
              onChange={v => set('riskMedium', v)} min={1} max={15} suffix="%" />
            <Field label="Low conviction — Conflicted"
              hint="W and D disagree"
              value={params.riskLow}
              onChange={v => set('riskLow', v)} min={1} max={10} suffix="%" />
          </Section>

          {/* Collateral Limits */}
          <Section title="Collateral Limits (% of total account)">
            <Field label="Warn — single ticker collateral"
              hint="Amber warning when exceeded"
              value={params.warnTickerCollPct}
              onChange={v => set('warnTickerCollPct', v)} min={5} max={49} suffix="%" />
            <Field label="Block — single ticker collateral"
              hint="Hard block in Signals tab"
              value={params.blockTickerCollPct}
              onChange={v => set('blockTickerCollPct', v)} min={10} max={100} suffix="%" />
            <Field label="Max single bucket collateral"
              hint="Total collateral in one sector"
              value={params.maxBucketCollPct}
              onChange={v => set('maxBucketCollPct', v)} min={5} max={80} suffix="%" />
            <Field label="Max portfolio deployed"
              hint="Reserve capital floor"
              value={params.maxPortfolioPct}
              onChange={v => set('maxPortfolioPct', v)} min={5} max={100} suffix="%" />
          </Section>

          {/* Dynamic Rules */}
          <Section title="Dynamic Rules">
            <div className={styles.ruleRow}>
              <div className={styles.ruleLeft}>
                <label className={styles.ruleToggle}>
                  <input
                    type="checkbox"
                    checked={params.blockNakedMoveEnabled}
                    onChange={e => set('blockNakedMoveEnabled', e.target.checked)}
                  />
                  <span className={styles.ruleLabel}>
                    Block naked if stock moves more than
                  </span>
                </label>
              </div>
              <div className={styles.fieldRight}>
                <input
                  className={styles.fieldInput}
                  type="number"
                  value={params.blockNakedMoveThreshold}
                  min={5} max={50}
                  disabled={!params.blockNakedMoveEnabled}
                  onChange={e => set('blockNakedMoveThreshold', Number(e.target.value))}
                />
                <span className={styles.fieldSuffix}>% in 3 days</span>
              </div>
            </div>

            <div className={styles.ruleRow}>
              <div className={styles.ruleLeft}>
                <label className={styles.ruleToggle}>
                  <input
                    type="checkbox"
                    checked={params.blockOvernightGapEnabled}
                    onChange={e => set('blockOvernightGapEnabled', e.target.checked)}
                  />
                  <span className={styles.ruleLabel}>
                    Block if overnight gap exceeds
                  </span>
                </label>
              </div>
              <div className={styles.fieldRight}>
                <input
                  className={styles.fieldInput}
                  type="number"
                  value={params.blockOvernightGapThreshold}
                  min={2} max={30}
                  disabled={!params.blockOvernightGapEnabled}
                  onChange={e => set('blockOvernightGapThreshold', Number(e.target.value))}
                />
                <span className={styles.fieldSuffix}>% overnight</span>
              </div>
            </div>
          </Section>

          {/* LEAP Management */}
          <Section title="LEAP Management">
            <Field label="Hedge staleness warning (days)"
              hint="Warn if no active hedge sold against LEAP"
              value={params.leapHedgeWarnDays}
              onChange={v => set('leapHedgeWarnDays', v)} min={7} max={90} />
          </Section>

        </div>

        <div className={styles.footer}>
          <button className={styles.resetBtn} onClick={handleReset}>Reset to defaults</button>
          <button className={styles.saveBtn} onClick={handleSave}>Save Parameters</button>
        </div>

      </div>
    </div>,
    document.body
  );
}

function Section({ title, children }) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>{title}</div>
      {children}
    </div>
  );
}

function Field({ label, hint, value, onChange, min, max, suffix }) {
  return (
    <div className={styles.field}>
      <div className={styles.fieldLeft}>
        <div className={styles.fieldLabel}>{label}</div>
        {hint && <div className={styles.fieldHint}>{hint}</div>}
      </div>
      <div className={styles.fieldRight}>
        <input
          className={styles.fieldInput}
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={e => onChange(Number(e.target.value))}
        />
        {suffix && <span className={styles.fieldSuffix}>{suffix}</span>}
      </div>
    </div>
  );
}
