import type { ReactElement } from 'react';
import styles from './Loading.module.css';

export function Loading(): ReactElement {
  return <p className={styles.quiet}>Loading…</p>;
}
