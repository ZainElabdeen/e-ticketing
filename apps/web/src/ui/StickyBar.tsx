import type { ReactElement, ReactNode } from 'react';
import styles from './StickyBar.module.css';

/** Action bar pinned to the bottom of the viewport on phones; inline from 640px. Never portalled. */
export function StickyBar(props: { children: ReactNode }): ReactElement {
  return <div className={styles.bar}>{props.children}</div>;
}
