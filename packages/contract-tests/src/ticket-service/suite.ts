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
import { register as registerAuth } from './auth.contract';
import { register as registerConfirm } from './confirm.contract';
import { register as registerHealth } from './health.contract';
import { register as registerOrders, registerQuotaDrain } from './orders.contract';
import { register as registerTicketTypes } from './ticket-types.contract';

export function runTicketServiceContract(getTarget: () => ContractTarget): void {
  describe('ticket-service contract', () => {
    const validator = ContractValidator.load('ticket-service');
    registerHealth(getTarget, validator);
    registerAuth(getTarget, validator);
    registerTicketTypes(getTarget, validator);
    registerOrders(getTarget, validator);
    registerConfirm(getTarget, validator);
    // Later areas that need quota go above this line: the drain empties VIP.
    registerQuotaDrain(getTarget, validator);
  });
}
