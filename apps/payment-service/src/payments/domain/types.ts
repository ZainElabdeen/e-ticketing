export type PaymentMethod = 'CARD' | 'QR';
export type PaymentStatus = 'PENDING' | 'SUCCEEDED' | 'CANCELLED';

export interface CardInput {
  number: string;
  expMonth: number;
  expYear: number;
  cvc: string;
  holder: string;
}

export interface CreatePaymentInput {
  orderId: string;
  method: PaymentMethod;
  card?: CardInput;
}
