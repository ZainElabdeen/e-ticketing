/**
 * Black-box contract suite for the Payment Service.
 *
 * Mutates the target: it creates payments, transactions and outbox events.
 * Never point it at production. Each area lives in its own `*.contract.ts`
 * module exporting `register(getTarget, validator)`.
 */
import { ContractValidator } from '../validator';
import { register as registerAuth } from './auth.contract';
import { registerHealthContract } from '../health';
import { register as registerPayments } from './payments.contract';
import { register as registerTransactions } from './transactions.contract';
import type { PaymentContractTarget } from './target';

export function runPaymentServiceContract(getTarget: () => PaymentContractTarget): void {
  describe('payment-service contract', () => {
    const validator = ContractValidator.load('payment-service');
    registerHealthContract(() => getTarget().baseUrl, validator);
    registerAuth(getTarget, validator);
    registerPayments(getTarget, validator);
    registerTransactions(getTarget, validator);
  });
}
