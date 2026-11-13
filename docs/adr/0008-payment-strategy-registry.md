# ADR-0008: Payment methods as Strategy + registry

## Context

The challenge requires pluggable payment methods: card and QR now; wallet,
bank transfer and crypto "easy to add". Card succeeds synchronously; QR
succeeds later, on the server.

## Decision

```ts
interface PaymentContext {
  paymentId: string;
  orderId: string;
  amountMinor: number;
  currency: string;
  input: CreatePaymentDto;      // validated request; handler reads its own fields
  now: Date;
}

type HandlerResult =
  | { kind: 'SUCCEEDED'; details: { cardLast4?: string } }
  | { kind: 'PENDING'; details: { qrPayload?: string }; succeedAfter: Date };

interface PaymentHandler {
  readonly method: PaymentMethod;                 // 'CARD' | 'QR' | …
  validate(input: CreatePaymentDto): void;        // throws INVALID_CARD etc.
  initiate(ctx: PaymentContext): HandlerResult;
}
```

`CardHandler` (Luhn + expiry → `SUCCEEDED`, `cardLast4`) and `QrHandler`
(`PENDING`, `qrPayload`, `succeedAfter = now + 8 s`) register in a registry
keyed by `method` (NestJS multi-provider; .NET keyed services if ever ported).
The application service knows only the interface: resolve handler → validate
→ initiate → persist → on `SUCCEEDED` run the success bookkeeping. Adding a
wallet = one handler class + one enum value in the contract + one CHECK value.

## Alternatives

- **switch(method) in the service**: fine for two methods, but each new method
  would edit core payment code, which is what the challenge asks to avoid.
- **A microservice per method**: far too much overhead at this scale.

## Trade-off

One more abstraction to explain; the registry itself is about 20 lines. The
pending-result path assumes server-driven completion (a timer here, a webhook
for a real QR provider); a method needing a customer redirect would add a
third `kind`.
