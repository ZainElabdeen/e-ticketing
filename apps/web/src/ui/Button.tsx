import type { ButtonHTMLAttributes, ReactElement } from 'react';
import styles from './Button.module.css';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'quiet';
};

export function Button({
  variant = 'primary',
  className,
  type,
  ...rest
}: ButtonProps): ReactElement {
  const classes = [styles.button, styles[variant], className].filter(Boolean).join(' ');
  return <button type={type ?? 'button'} className={classes} {...rest} />;
}
