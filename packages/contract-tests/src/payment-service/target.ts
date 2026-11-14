export interface PaymentContractTarget {
  baseUrl: string;
  publicApiKey: string;
  /** The target's QR_SUCCESS_DELAY_SECONDS. */
  qrDelaySeconds: number;
  /** A fresh PENDING order the Payment Service can read from the Ticket Service. */
  newPayableOrder(): Promise<{ id: string; totalMinor: number; currency: string }>;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

/** Runner 2: an external Payment Service plus the Ticket Service it reads orders from. */
export function paymentTargetFromEnv(): PaymentContractTarget {
  const ticketBase = required('CONTRACT_TICKET_BASE_URL').replace(/\/+$/, '');
  const ticketKey = required('CONTRACT_TICKET_API_KEY');
  return {
    baseUrl: required('CONTRACT_PAYMENT_BASE_URL'),
    publicApiKey: required('CONTRACT_PAYMENT_API_KEY'),
    qrDelaySeconds: Number(process.env.CONTRACT_QR_DELAY_SECONDS ?? 8),
    async newPayableOrder() {
      const res = await fetch(`${ticketBase}/v1/orders`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': ticketKey },
        body: JSON.stringify({ items: [{ ticketTypeCode: 'GOLD', quantity: 1 }] }),
      });
      if (res.status !== 201) {
        throw new Error(`Ticket Service refused to create an order: HTTP ${res.status}`);
      }
      const order = (await res.json()) as { id: string; totalMinor: number; currency: string };
      return { id: order.id, totalMinor: order.totalMinor, currency: order.currency };
    },
  };
}
