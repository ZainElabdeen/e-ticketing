---
name: repo-review
description: Use when reviewing a branch, pull request or diff in this repo, or after finishing a task and before merging. Checks the diff against the repo's payment, ledger, contract and security invariants and reports severity-ranked findings with evidence.
---

# Code review (this repo)

Reviews a change against the rules that make this system correct. Generic style
is out of scope: lint and Prettier own it.

## Steps

1. **Scope**: `git diff --stat <base>...HEAD` (base is `dev` unless told
   otherwise). List the touched areas.
2. **Load the rules** for each touched area: its `AGENTS.md`, plus
   `packages/nest-common/AGENTS.md` for Nest apps, plus the spec section and
   ADRs it names.
3. **Read every changed file in full**, not only the hunks, and the callers of
   any changed function.
4. **Check the invariants** that apply:
   - **Money**: integer minor units + currency; amounts come from the Ticket
     Service, never the client.
   - **Idempotency**: `Idempotency-Key` required; same key + same body replays;
     different body → 422; claim, payment, transaction, outbox and response in
     one DB transaction.
   - **Quota**: one conditional UPDATE; lock order = order row, then ticket types
     ascending by code; expiry releases.
   - **Ledger**: debits = credits, append-only, `UNIQUE(transaction_id)`.
   - **Outbox**: retries are idempotent on both sides (Ledger post, Ticket
     confirm).
   - **Contracts**: OpenAPI changed first; generated types committed; the Ticket Service (.NET) passes the contract suite.
   - **Security**: no PAN/CVC stored or logged; API keys server-side only;
     validation on every input; secrets only via env; error bodies never leak
     internals.
   - **DB**: CHECK constraints, indexes, no cross-schema FK, migration not
     edited after apply.
   - **Web**: the `web-review` passes for changed files.
   - **Tests**: payment, idempotency, quota and ledger logic changed test-first;
     each bug fix has a test that failed before it.
5. **Verify claims** by running the touched packages' `test` and, for DB or HTTP
   changes, `test:int`.

## Report

| Sev | file:line | Finding | Evidence | Fix |
| --- | --------- | ------- | -------- | --- |

Severity: **Critical** (money, card data, auth), **High** (wrong behaviour,
broken contract), **Medium** (missing test or validation, maintainability),
**Low** (polish). Each finding is something you confirmed in code; suspicions
go in a separate "to verify" list. End with what you ran and its result.

## Done when

Every changed file was read in full, every applicable invariant was checked,
and every finding has a location and evidence.
