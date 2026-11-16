import type { ReactElement, ReactNode } from 'react';
import styles from './TicketStub.module.css';

export type StubTier = 'GOLD' | 'PREMIUM' | 'VIP' | 'NEUTRAL';

const TIER_CLASS: Record<StubTier, string> = {
  GOLD: styles.gold!,
  PREMIUM: styles.premium!,
  VIP: styles.vip!,
  NEUTRAL: styles.neutral!,
};

const DEFAULT_EYEBROW: Record<StubTier, string | undefined> = {
  GOLD: 'Admit one · Gold',
  PREMIUM: 'Admit one · Premium',
  VIP: 'Admit one · VIP',
  NEUTRAL: undefined,
};

/** A perforated ticket: tier eyebrow, main body, and a right-hand stub (folds below when narrow). */
export function TicketStub(props: {
  tier: StubTier;
  children: ReactNode;
  stub: ReactNode;
  eyebrow?: ReactNode;
}): ReactElement {
  const eyebrow = props.eyebrow ?? DEFAULT_EYEBROW[props.tier];
  return (
    <article className={styles.frame}>
      <div className={`${styles.ticket} ${TIER_CLASS[props.tier]}`}>
        <div className={styles.surface}>
          <div className={styles.body}>
            {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
            {props.children}
          </div>
          <div className={styles.stub}>{props.stub}</div>
        </div>
      </div>
    </article>
  );
}
