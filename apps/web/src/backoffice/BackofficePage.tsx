import { useCallback, useRef, type KeyboardEvent, type ReactElement } from 'react';
import { useSearchParams } from 'react-router';
import { Button } from '../ui/Button';
import { useAuth } from './AuthProvider';
import styles from './BackofficePage.module.css';
import { AccountsTab } from './tabs/AccountsTab';
import { AvailabilityTab } from './tabs/AvailabilityTab';
import { LedgerEntriesTab } from './tabs/LedgerEntriesTab';
import { TransactionsTab } from './tabs/TransactionsTab';

const TABS = [
  { id: 'transactions', label: 'Transactions' },
  { id: 'ledger', label: 'Ledger entries' },
  { id: 'accounts', label: 'Account balances' },
  { id: 'availability', label: 'Ticket availability' },
] as const;
type TabId = (typeof TABS)[number]['id'];

function parsePage(raw: string | null): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

export function BackofficePage(): ReactElement {
  const { logout } = useAuth();
  const [params, setParams] = useSearchParams();
  const rawTab = params.get('tab');
  const tab: TabId = TABS.find((t) => t.id === rawTab)?.id ?? 'transactions';
  const page = parsePage(params.get('page'));

  const go = useCallback(
    (next: TabId, nextPage: number, replace = false) => {
      const p: Record<string, string> = { tab: next };
      if (nextPage > 1) p.page = String(nextPage);
      setParams(p, { replace });
    },
    [setParams],
  );
  const onPage = useCallback((p: number, replace?: boolean) => go(tab, p, replace), [go, tab]);

  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  // APG tabs, automatic activation: arrows, Home and End select the tab and move focus to it.
  const onTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const last = TABS.length - 1;
    const target =
      e.key === 'ArrowRight'
        ? (index + 1) % TABS.length
        : e.key === 'ArrowLeft'
          ? (index + last) % TABS.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : null;
    if (target === null) return;
    e.preventDefault();
    go(TABS[target]!.id, 1);
    tabRefs.current[target]?.focus();
  };

  return (
    <section>
      <div className={styles.head}>
        <h1>Backoffice</h1>
        <Button variant="quiet" onClick={() => logout()}>
          Sign out
        </Button>
      </div>
      <div className={styles.tabs} role="tablist" aria-label="Backoffice sections">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            tabIndex={tab === t.id ? 0 : -1}
            onKeyDown={(e) => onTabKeyDown(e, i)}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="backoffice-panel"
            className={styles.tab}
            onClick={() => go(t.id, 1)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="backoffice-panel" aria-labelledby={`tab-${tab}`}>
        {tab === 'transactions' ? <TransactionsTab page={page} onPage={onPage} /> : null}
        {tab === 'ledger' ? <LedgerEntriesTab page={page} onPage={onPage} /> : null}
        {tab === 'accounts' ? <AccountsTab /> : null}
        {tab === 'availability' ? <AvailabilityTab /> : null}
      </div>
    </section>
  );
}
