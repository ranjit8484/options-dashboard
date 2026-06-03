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
  const variant = p === 'RH' ? 'rh' : p === 'FID' ? 'fid' : 'meta';
  return <Badge variant={variant}>{p || platform}</Badge>;
}
