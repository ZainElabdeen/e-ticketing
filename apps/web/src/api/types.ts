import type { Gateway } from '@eticket/contracts';

type Schemas = Gateway.components['schemas'];

export type TicketType = Schemas['TicketType'];
export type Order = Schemas['Order'];
export type Payment = Schemas['Payment'];
export type Transaction = Schemas['Transaction'];
export type JournalEntry = Schemas['JournalEntry'];
export type Account = Schemas['Account'];
export type AccountList = Schemas['AccountList'];
export type CreatePaymentBody = Schemas['CreatePaymentRequest'];
export type CardDetails = Schemas['CardDetails'];
