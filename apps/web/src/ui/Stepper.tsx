import type { ReactElement } from 'react';
import styles from './Stepper.module.css';

export type StepperProps = {
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  label: string;
};

export function Stepper({ value, min, max, onChange, label }: StepperProps): ReactElement {
  return (
    <div className={styles.stepper} role="group" aria-label={label}>
      <button
        type="button"
        className={styles.step}
        aria-label={`Decrease ${label}`}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        −
      </button>
      <output className={styles.value} aria-label={`${label} quantity`}>
        {value}
      </output>
      <button
        type="button"
        className={styles.step}
        aria-label={`Increase ${label}`}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        +
      </button>
    </div>
  );
}
