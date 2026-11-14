// Maps the compose keys (loaded into process.env by `node --env-file`) to the
// CONTRACT_* variables the suites expect, then runs the suite. Never prints a key.
import { spawnSync } from 'node:child_process';
import { assertGateway } from './gateway-target.mjs';

const [suite, ticketUrlArg] = process.argv.slice(2);
if (process.argv.length > 4 || !['ticket', 'payment', 'ledger', 'gateway'].includes(suite ?? '')) {
  console.error('usage: infra/scripts/contract.sh <ticket|payment|ledger|gateway> [ticketBaseUrl]');
  process.exit(2);
}

const ticketUrl = ticketUrlArg ?? 'http://127.0.0.1:3001';
const need = (name) => {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set in infra/.env`);
    process.exit(2);
  }
  return value;
};

const gatewayUrl =
  process.env.CONTRACT_GATEWAY_BASE_URL ??
  `http://127.0.0.1:${process.env.GATEWAY_HOST_PORT ?? 3000}`;

// Fail fast on a wrong target (another project on the same port) before any credential is sent.
if (suite === 'gateway') {
  await assertGateway(gatewayUrl);
}

const mapped = {
  ticket: () => ({
    CONTRACT_BASE_URL: ticketUrl,
    CONTRACT_API_KEY: need('PUBLIC_API_KEY_TICKET'),
    CONTRACT_INTERNAL_API_KEY: need('INTERNAL_API_KEY_TICKET'),
  }),
  payment: () => ({
    CONTRACT_PAYMENT_BASE_URL: 'http://127.0.0.1:3002',
    CONTRACT_PAYMENT_API_KEY: need('PUBLIC_API_KEY_PAYMENT'),
    CONTRACT_TICKET_BASE_URL: ticketUrl,
    CONTRACT_TICKET_API_KEY: need('PUBLIC_API_KEY_TICKET'),
  }),
  ledger: () => ({
    CONTRACT_LEDGER_BASE_URL: 'http://127.0.0.1:3003',
    CONTRACT_LEDGER_API_KEY: need('PUBLIC_API_KEY_LEDGER'),
    CONTRACT_LEDGER_INTERNAL_API_KEY: need('INTERNAL_API_KEY_LEDGER'),
  }),
  gateway: () => ({
    CONTRACT_GATEWAY_BASE_URL: gatewayUrl,
    CONTRACT_ADMIN_EMAIL: need('ADMIN_EMAIL'),
    CONTRACT_ADMIN_PASSWORD: need('ADMIN_PASSWORD_DEV'),
  }),
}[suite]();

const result = spawnSync(
  'pnpm',
  ['--filter', '@eticket/contract-tests', `test:contract:${suite}`],
  {
    stdio: 'inherit',
    env: { ...process.env, ...mapped },
  },
);
process.exit(result.status ?? 1);
