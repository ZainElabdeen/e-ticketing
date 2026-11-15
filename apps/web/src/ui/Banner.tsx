import type { ReactElement, ReactNode } from 'react';
import styles from './Banner.module.css';

export function Banner(props: { tone?: 'error' | 'info'; children: ReactNode }): ReactElement {
  const tone = props.tone ?? 'error';
  return (
    <div
      role={tone === 'info' ? 'status' : 'alert'}
      aria-live={tone === 'info' ? 'polite' : undefined}
      className={`${styles.banner} ${styles[tone]}`}
    >
      {props.children}
    </div>
  );
}
