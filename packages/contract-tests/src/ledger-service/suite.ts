/**
 * Black-box contract suite for the Ledger Service.
 *
 * Mutates the target: it posts journal entries (append-only, never removed).
 * Never point it at production. Each area lives in its own `*.contract.ts`
 * module exporting `register(getTarget, validator)`.
 */
import { ContractValidator } from '../validator';
import { register as registerAuth } from './auth.contract';
import { register as registerHealth } from './health.contract';
import { register as registerPostings } from './postings.contract';
import { register as registerReads } from './reads.contract';
import type { LedgerContractTarget } from './target';

export function runLedgerServiceContract(getTarget: () => LedgerContractTarget): void {
  describe('ledger-service contract', () => {
    const validator = ContractValidator.load('ledger-service');
    registerHealth(getTarget, validator);
    registerAuth(getTarget, validator);
    registerPostings(getTarget, validator);
    registerReads(getTarget, validator);
  });
}
