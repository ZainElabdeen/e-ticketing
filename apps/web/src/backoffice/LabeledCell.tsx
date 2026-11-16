import type { ReactElement, ReactNode } from 'react';
import styles from './tables.module.css';

interface Props {
  label: string;
  className?: string;
  children?: ReactNode;
}

const isEmpty = (children: ReactNode): boolean =>
  children === null || children === undefined || children === '' || children === false;

/** Body cell whose column label shows only in the phone card layout. */
export function LabeledCell({ label, className, children }: Props): ReactElement {
  return (
    <td className={className}>
      {isEmpty(children) ? null : (
        <>
          <span aria-hidden="true" className={styles.cellLabel}>
            {label}
          </span>
          {children}
        </>
      )}
    </td>
  );
}
