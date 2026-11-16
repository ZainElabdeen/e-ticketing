import { QRCodeSVG } from 'qrcode.react';
import type { ReactElement } from 'react';
import styles from './QrPage.module.css';

export function QrCode({ payload }: { payload: string }): ReactElement {
  return (
    <>
      <div className={styles.code}>
        <QRCodeSVG
          value={payload}
          size={224}
          level="M"
          title="Payment QR code"
          className={styles.qr}
        />
      </div>
      <p className={styles.hint}>
        Scan the code with your banking app. In this simulation the server completes the payment by
        itself after about 8 seconds.
      </p>
    </>
  );
}
