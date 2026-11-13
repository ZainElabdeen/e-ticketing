-- ledger schema — see docs/spec.md §3.3 (ADR-0015: hand-written SQL, applied
-- with `prisma migrate deploy` as ledger_owner).

CREATE TABLE ledger.accounts (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code      text NOT NULL UNIQUE,
  name      text NOT NULL,
  type      text NOT NULL CHECK (type IN ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE')),
  currency  char(3) NOT NULL DEFAULT 'AED'
);

CREATE TABLE ledger.journal_entries (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id     uuid NOT NULL UNIQUE,
  posting_type       text NOT NULL CHECK (posting_type IN ('TICKET_SALE', 'UNFULFILLED_PAYMENT')),
  payment_reference  text NOT NULL,
  order_id           uuid NOT NULL,
  description        text NOT NULL,
  currency           char(3) NOT NULL,
  correlation_id     text NULL,
  posted_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX journal_entries_posted_at_idx ON ledger.journal_entries (posted_at);

CREATE TABLE ledger.journal_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id  uuid NOT NULL REFERENCES ledger.journal_entries (id),
  account_id        uuid NOT NULL REFERENCES ledger.accounts (id),
  direction         text NOT NULL CHECK (direction IN ('DEBIT', 'CREDIT')),
  amount_minor      bigint NOT NULL CHECK (amount_minor > 0)
);

CREATE INDEX journal_lines_journal_entry_id_idx ON ledger.journal_lines (journal_entry_id);
CREATE INDEX journal_lines_account_id_idx ON ledger.journal_lines (account_id);

INSERT INTO ledger.accounts (code, name, type) VALUES
  ('1100', 'Payment Gateway Clearing', 'ASSET'),
  ('2100', 'Customer Refunds Payable', 'LIABILITY'),
  ('4000', 'Ticket Sales Revenue', 'REVENUE');

-- Balance check: one function, two deferred constraint triggers. The trigger on
-- journal_entries is what rejects an entry with zero lines (a trigger on lines
-- alone never fires for it); the trigger on lines covers entries whose lines
-- arrive after the entry row.
CREATE FUNCTION ledger.assert_entry_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_entry uuid;
  v_lines int;
  v_debit bigint;
  v_credit bigint;
  v_currency_ok boolean;
BEGIN
  IF TG_TABLE_NAME = 'journal_entries' THEN
    v_entry := NEW.id;
  ELSE
    v_entry := NEW.journal_entry_id;
  END IF;

  SELECT count(l.id),
         coalesce(sum(l.amount_minor) FILTER (WHERE l.direction = 'DEBIT'), 0),
         coalesce(sum(l.amount_minor) FILTER (WHERE l.direction = 'CREDIT'), 0),
         coalesce(bool_and(a.currency = e.currency), true)
    INTO v_lines, v_debit, v_credit, v_currency_ok
    FROM ledger.journal_entries e
    LEFT JOIN ledger.journal_lines l ON l.journal_entry_id = e.id
    LEFT JOIN ledger.accounts a ON a.id = l.account_id
   WHERE e.id = v_entry;

  IF v_lines < 2 THEN
    RAISE EXCEPTION 'journal entry % has fewer than 2 lines', v_entry USING ERRCODE = 'check_violation';
  END IF;
  IF NOT v_currency_ok THEN
    RAISE EXCEPTION 'journal entry % has a line whose account currency differs from the entry currency', v_entry USING ERRCODE = 'check_violation';
  END IF;
  IF v_debit <> v_credit THEN
    RAISE EXCEPTION 'journal entry % is unbalanced: debits % credits %', v_entry, v_debit, v_credit USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER journal_entries_balanced
  AFTER INSERT ON ledger.journal_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger.assert_entry_balanced();

CREATE CONSTRAINT TRIGGER journal_lines_balanced
  AFTER INSERT ON ledger.journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger.assert_entry_balanced();

-- Append-only: the runtime role may read and insert journal rows, never change
-- or remove them (spec §3.3, ADR-0009). Default privileges from the bootstrap
-- granted UPDATE/DELETE on every new table, so they are revoked here, after the
-- journal tables exist.
REVOKE UPDATE, DELETE, TRUNCATE ON ledger.journal_entries, ledger.journal_lines FROM ledger_app;
