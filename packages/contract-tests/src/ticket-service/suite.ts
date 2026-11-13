/**
 * Black-box contract suite for the Ticket Service.
 *
 * Mutates the target, because it reserves quota and confirms orders.
 * Never point it at production.
 *
 * `getTarget` is a function because the in-process runner only learns the
 * base URL after its `beforeAll` has started the app. Each area lives in its
 * own `*.contract.ts` module exporting `register(getTarget, validator)`.
 */
import type { ContractTarget } from '../target';
import { ContractValidator } from '../validator';

export function runTicketServiceContract(getTarget: () => ContractTarget): void {
  describe('ticket-service contract', () => {
    const validator = ContractValidator.load('ticket-service');
    void getTarget;
    void validator;
  });
}
