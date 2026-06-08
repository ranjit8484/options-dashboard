import styles from './Badge.module.css';

export function Badge({ variant = 'meta', children }) {
  return <span className={`${styles.badge} ${styles[variant]}`}>{children}</span>;
}

export function StatusBadge({ status }) {
  const label = { danger: 'DANGER', watch: 'WATCH', safe: 'SAFE' }[status];
  return <Badge variant={status}>{label}</Badge>;
}

export function PlatBadge({ platform }) {
  const p = (platform || '').toString().trim().toUpperCase();
  if (p === 'RH') return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:'5px',
      padding:'2px 8px', borderRadius:'5px', fontSize:'11px',
      fontFamily:'monospace', fontWeight:'700',
      background:'rgba(202,255,0,.1)',
      border:'1px solid rgba(202,255,0,.25)',
      color:'#7a9900', marginLeft:'6px',
      verticalAlign:'middle'
    }}>
      <svg width="12" height="12" viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg">
        <rect width="14" height="14" rx="3" fill="#CAFF00"/>
        <path d="M7 12 C7 12 5.5 8 7 5.5 C8.5 3 10 5 9.5 7 C9 9 7 9 7 12Z" fill="#111"/>
        <path d="M7 12 L8 7" stroke="#CAFF00" strokeWidth="0.7" fill="none"/>
      </svg>
      RH
    </span>
  );
  if (p === 'FID') return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:'5px',
      padding:'2px 8px', borderRadius:'5px', fontSize:'11px',
      fontFamily:'monospace', fontWeight:'700',
      background:'rgba(27,94,32,.15)',
      border:'1px solid rgba(139,105,20,.35)',
      color:'#C8A951', marginLeft:'6px',
      verticalAlign:'middle'
    }}>
      <svg width="12" height="12" viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg">
        <rect width="14" height="14" rx="3" fill="#1B5E20"/>
        <circle cx="7" cy="7" r="5" fill="#2E7D32"/>
        <polygon points="7,3 9.5,11 7,9.5 4.5,11" fill="#C8A951"/>
        <line x1="5.5" y1="9" x2="8.5" y2="9" stroke="#1B5E20" strokeWidth="0.8"/>
      </svg>
      FID
    </span>
  );
  return <Badge variant="meta">{p}</Badge>;
}
