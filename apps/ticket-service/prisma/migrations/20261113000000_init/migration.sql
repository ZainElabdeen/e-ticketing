-- tickets schema — see docs/spec.md §3.1 (ADR-0015: hand-written SQL, applied
-- with `prisma migrate deploy` as tickets_owner).

CREATE TABLE tickets.ticket_types (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL UNIQUE,
  name          text NOT NULL,
  price_minor   bigint NOT NULL CHECK (price_minor > 0),
  currency      char(3) NOT NULL DEFAULT 'AED',
  quota         int NOT NULL CHECK (quota >= 0),
  sold          int NOT NULL DEFAULT 0 CHECK (sold >= 0),
  reserved      int NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  CONSTRAINT ticket_types_sold_reserved_within_quota CHECK (sold + reserved <= quota)
);

CREATE TABLE tickets.orders (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status               text NOT NULL CHECK (status IN ('PENDING', 'CONFIRMED', 'EXPIRED')),
  total_minor          bigint NOT NULL CHECK (total_minor > 0),
  currency             char(3) NOT NULL DEFAULT 'AED',
  created_at           timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz NOT NULL,
  confirmed_at         timestamptz NULL,
  paid_transaction_id  uuid NULL,
  CONSTRAINT orders_paid_transaction_id_key UNIQUE (paid_transaction_id),
  CONSTRAINT orders_confirmation_consistent
    CHECK ((status = 'CONFIRMED') = (confirmed_at IS NOT NULL AND paid_transaction_id IS NOT NULL))
);

CREATE INDEX orders_status_expires_at_idx ON tickets.orders (status, expires_at);
CREATE INDEX orders_created_at_idx ON tickets.orders (created_at);

CREATE TABLE tickets.order_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          uuid NOT NULL REFERENCES tickets.orders (id),
  ticket_type_id    uuid NOT NULL REFERENCES tickets.ticket_types (id),
  quantity          int NOT NULL CHECK (quantity BETWEEN 1 AND 10),
  unit_price_minor  bigint NOT NULL CHECK (unit_price_minor > 0),
  line_total_minor  bigint NOT NULL CHECK (line_total_minor = unit_price_minor * quantity),
  CONSTRAINT order_items_order_ticket_type_key UNIQUE (order_id, ticket_type_id)
);

CREATE INDEX order_items_order_id_idx ON tickets.order_items (order_id);

INSERT INTO tickets.ticket_types (code, name, price_minor, quota)
VALUES
  ('GOLD', 'Gold', 10000, 100),
  ('PREMIUM', 'Premium', 20000, 100),
  ('VIP', 'VIP', 50000, 100);
