export type PostingType = 'TICKET_SALE' | 'UNFULFILLED_PAYMENT';
export type Direction = 'DEBIT' | 'CREDIT';
export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';

export interface PostingInput {
  transactionId: string;
  postingType: PostingType;
  orderId: string;
  paymentReference: string;
  amountMinor: number;
  currency: string;
}

export interface PlannedLine {
  accountCode: string;
  direction: Direction;
  amountMinor: number;
}

/** transactionId is equal by construction, so it is not compared. */
export function samePosting(stored: PostingInput, incoming: PostingInput): boolean {
  return (
    stored.postingType === incoming.postingType &&
    stored.orderId === incoming.orderId &&
    stored.paymentReference === incoming.paymentReference &&
    stored.amountMinor === incoming.amountMinor &&
    stored.currency === incoming.currency
  );
}
