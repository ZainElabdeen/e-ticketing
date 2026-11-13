-- payments schema — see docs/spec.md §3.2 (ADR-0015: hand-written SQL, applied
-- with `prisma migrate deploy` as payments_owner).

CREATE TABLE payments.payments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       uuid NOT NULL,
  method         text NOT NULL CHECK (method IN ('CARD', 'QR')),
  status         text NOT NULL CHECK (status IN ('PENDING', 'SUCCEEDED', 'CANCELLED')),
  amount_minor   bigint NOT NULL CHECK (amount_minor > 0),
  currency       char(3) NOT NULL DEFAULT 'AED',
  card_last4     char(4) NULL,
  qr_payload     text NULL,
  succeed_after  timestamptz NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  succeeded_at   timestamptz NULL,
  cancelled_at   timestamptz NULL
);

-- One live payment per order (spec §4.2): a PENDING or SUCCEEDED payment blocks
-- a second one; CANCELLED rows free the order again.
CREATE UNIQUE INDEX payments_one_live_per_order
  ON payments.payments (order_id)
  WHERE status IN ('PENDING', 'SUCCEEDED');

CREATE INDEX payments_status_succeed_after_idx ON payments.payments (status, succeed_after);
CREATE INDEX payments_order_id_idx ON payments.payments (order_id);
CREATE INDEX payments_created_at_idx ON payments.payments (created_at);

CREATE TABLE payments.transactions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id         uuid NOT NULL UNIQUE REFERENCES payments.payments (id),
  payment_reference  text NOT NULL UNIQUE,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX transactions_created_at_idx ON payments.transactions (created_at);

CREATE TABLE payments.idempotency_keys (
  key              text PRIMARY KEY CHECK (char_length(key) BETWEEN 8 AND 128),
  request_hash     char(64) NOT NULL,
  payment_id       uuid NULL REFERENCES payments.payments (id),
  response_status  int NULL,
  response_body    jsonb NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT idempotency_keys_response_pair
    CHECK ((response_status IS NULL) = (response_body IS NULL))
);

CREATE TABLE payments.outbox_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type             text NOT NULL CHECK (type IN ('payment.succeeded')),
  payload          jsonb NOT NULL,
  status           text NOT NULL DEFAULT 'PENDING'
                     CHECK (status IN ('PENDING', 'DONE', 'FAILED')),
  confirm_outcome  text NULL CHECK (confirm_outcome IN ('CONFIRMED', 'NOT_CONFIRMABLE')),
  attempts         int NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  last_error       text NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  processed_at     timestamptz NULL
);

CREATE INDEX outbox_events_status_next_attempt_at_idx
  ON payments.outbox_events (status, next_attempt_at);
