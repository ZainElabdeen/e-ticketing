import type { ReactElement } from 'react';
import styles from './CheckoutPage.module.css';

export type Method = 'CARD' | 'QR';

export function MethodPicker(props: {
  method: Method;
  onChange: (m: Method) => void;
}): ReactElement {
  const { method, onChange } = props;
  return (
    <fieldset className={styles.method}>
      <legend>How do you want to pay?</legend>
      <div className={styles.choices}>
        {(['CARD', 'QR'] as const).map((m) => (
          <label key={m} className={styles.choice}>
            <input
              type="radio"
              name="method"
              value={m}
              checked={method === m}
              onChange={() => onChange(m)}
            />
            {m === 'CARD' ? 'Credit card' : 'QR scan'}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
