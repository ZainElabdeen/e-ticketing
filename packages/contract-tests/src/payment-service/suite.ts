/**
 * Black-box contract suite for the Payment Service.
 *
 * Mutates the target: it creates payments, transactions and outbox events.
 * Never point it at production. Each area lives in its own `*.contract.ts`
 * module exporting `register(getTarget, validator)`.
 */
import { ContractValidator } from '../validator';
import { register as registerAuth } from './auth.contract';
import { register as registerHealth } from './health.contract';
import { register as registerPayments } from './payments.contract';
import type { PaymentContractTarget } from './target';

export function runPaymentServiceContract(getTarget: () => PaymentContractTarget): void {
  describe('payment-service contract', () => {
    const validator = ContractValidator.load('payment-service');
    registerHealth(getTarget, validator);
    registerAuth(getTarget, validator);
    registerPayments(getTarget, validator);
  });
}
