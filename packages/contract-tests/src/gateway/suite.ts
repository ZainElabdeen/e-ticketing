/**
 * Black-box contract suite for the Gateway.
 *
 * It fits inside the production rate limits in one run, so it can target a
 * compose stack with default limits: 2 order creations (limit 4), 4 logins
 * (limit 6) and about 25 requests in total (limit 60). Keep it that way when
 * adding tests. It mutates the target (creates an order and a payment).
 */
import { ContractValidator } from '../validator';
import { register as registerAllowList } from './allow-list.contract';
import { register as registerAuth } from './auth.contract';
import { register as registerBackoffice } from './backoffice.contract';
import { createContext } from './context';
import { register as registerHealth } from './health.contract';
import { register as registerShop } from './shop.contract';
import type { GatewayContractTarget } from './target';

export function runGatewayContract(getTarget: () => GatewayContractTarget): void {
  describe('gateway contract', () => {
    const validator = ContractValidator.load('gateway');
    const ctx = createContext(getTarget);
    registerHealth(getTarget, validator);
    registerShop(getTarget, validator);
    registerAuth(getTarget, validator, ctx);
    registerBackoffice(getTarget, validator, ctx);
    registerAllowList(getTarget);
  });
}
