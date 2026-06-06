import styles from './TabNav.module.css';

export function TabNav({ activeTab, setTab, isPublic }) {
  const tabs = [
    ...(!isPublic ? [{ id: 'active',  label: 'Active',  icon: '📊' }] : []),
    { id: 'signals', label: 'Signals', icon: '🔍' },
    ...(!isPublic ? [{ id: 'closed',  label: 'Closed',  icon: '📈' }] : []),
  ];
  return (
    <nav className={styles.nav}>
      {tabs.map(t => (
        <button
          key={t.id}
          className={`${styles.tab} ${activeTab === t.id ? styles.active : ''}`}
          onClick={() => setTab(t.id)}
        >
          <span className={styles.icon}>{t.icon}</span>
          <span className={styles.label}>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
