import type { ReactElement, ReactNode } from 'react';
import styles from './TicketStub.module.css';

export type StubTier = 'GOLD' | 'PREMIUM' | 'VIP' | 'NEUTRAL';

const TIER_CLASS: Record<StubTier, string> = {
  GOLD: styles.gold!,
  PREMIUM: styles.premium!,
  VIP: styles.vip!,
  NEUTRAL: styles.neutral!,
};

/** A perforated ticket: tier band, main body, and a right-hand stub (folds below on mobile). */
export function TicketStub(props: {
  tier: StubTier;
  children: ReactNode;
  stub: ReactNode;
}): ReactElement {
  return (
    <article className={`${styles.ticket} ${TIER_CLASS[props.tier]}`}>
      <div className={styles.surface}>
        <div className={styles.body}>{props.children}</div>
        <div className={styles.stub}>{props.stub}</div>
      </div>
    </article>
  );
}
