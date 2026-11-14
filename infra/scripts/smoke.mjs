import { assertGateway } from './gateway-target.mjs';

// End-to-end smoke test through the Gateway. Node 26 global fetch only. Never prints a secret.
const env = (name) => {
  const value = process.env[name];
  if (!value) fail(`missing env var ${name}`);
  return value;
};
function fail(message) {
  console.error(`SMOKE FAILED: ${message}`);
  process.exit(1);
}
const expect = (condition, message) => {
  if (!condition) fail(message);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Everything goes through the Gateway, the only public edge: no service API keys here.
// The backoffice calls carry the admin JWT. No password or token is ever printed.
const GATEWAY =
  process.env.SMOKE_GATEWAY_URL ?? `http://127.0.0.1:${process.env.GATEWAY_HOST_PORT ?? 3000}`;
await assertGateway(GATEWAY);
const adminEmail = env('ADMIN_EMAIL');
const adminPassword = env('ADMIN_PASSWORD_DEV');

async function call(step, method, url, auth, body, extraHeaders = {}) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        ...(auth ? { authorization: `Bearer ${auth}` } : {}),
        'content-type': 'application/json',
        ...extraHeaders,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    fail(`${step}: ${method} ${url} failed: ${err.message}`);
  }
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    fail(`${step}: ${method} ${url} returned non-JSON (HTTP ${res.status})`);
  }
  return { status: res.status, json };
}

async function createOrder(step, ticketType, quantity) {
  const { status, json } = await call(step, 'POST', `${GATEWAY}/v1/orders`, undefined, {
    items: [{ ticketTypeCode: ticketType, quantity }],
  });
  expect(status === 201, `${step}: create order expected 201, got ${status}`);
  expect(json.totalMinor === 20000, `${step}: order total expected 20000, got ${json.totalMinor}`);
  return json;
}

async function pay(step, orderId, method, card) {
  const body = { orderId, method, ...(card ? { card } : {}) };
  const { status, json } = await call(step, 'POST', `${GATEWAY}/v1/payments`, undefined, body, {
    'idempotency-key': crypto.randomUUID(),
  });
  expect(status === 200 || status === 201, `${step}: create payment expected 2xx, got ${status}`);
  return json;
}

// Step 0: backoffice login
const login = await call('login', 'POST', `${GATEWAY}/v1/auth/login`, undefined, {
  email: adminEmail,
  password: adminPassword,
});
expect(login.status === 200, `login: expected 200, got ${login.status}`);
expect(typeof login.json.accessToken === 'string', 'login: no accessToken in the response');
const jwt = login.json.accessToken;
console.log('0. backoffice login OK');

// Step 1: card order
const orderA = await createOrder('card order', 'GOLD', 2);
const payA = await pay('card order', orderA.id, 'CARD', {
  number: '4242424242424242',
  expMonth: 12,
  expYear: new Date().getFullYear() + 2,
  cvc: '123',
  holder: 'Smoke Test',
});
expect(
  payA.status === 'SUCCEEDED',
  `card order: payment status expected SUCCEEDED, got ${payA.status}`,
);
console.log(`1. card order ${orderA.id} paid, payment ${payA.id} SUCCEEDED`);

// Step 2: QR order
const orderB = await createOrder('QR order', 'PREMIUM', 1);
let payB = await pay('QR order', orderB.id, 'QR');
expect(payB.status === 'PENDING', `QR order: payment status expected PENDING, got ${payB.status}`);
for (let i = 0; i < 20 && payB.status !== 'SUCCEEDED'; i += 1) {
  await sleep(1000);
  const { status, json } = await call('QR order', 'GET', `${GATEWAY}/v1/payments/${payB.id}`);
  expect(status === 200, `QR order: poll expected 200, got ${status}`);
  payB = json;
}
expect(payB.status === 'SUCCEEDED', `QR order: payment still ${payB.status} after 20 s`);
console.log(`2. QR order ${orderB.id} paid, payment ${payB.id} SUCCEEDED`);

// Step 3: ledger entries
const wanted = [payA.transaction?.transactionId, payB.transaction?.transactionId];
expect(wanted.every(Boolean), 'ledger: a payment has no transaction.transactionId');
let missing = wanted;
for (let i = 0; i < 30; i += 1) {
  const { status, json } = await call(
    'ledger',
    'GET',
    `${GATEWAY}/v1/backoffice/ledger-entries?pageSize=100`,
    jwt,
  );
  expect(status === 200, `ledger: list expected 200, got ${status}`);
  const sales = new Set(
    json.data.filter((e) => e.postingType === 'TICKET_SALE').map((e) => e.transactionId),
  );
  missing = wanted.filter((id) => !sales.has(id));
  if (missing.length === 0) break;
  await sleep(1000);
}
expect(missing.length === 0, `ledger: ${missing.length} TICKET_SALE entries missing after 30 s`);
console.log('3. ledger has both TICKET_SALE entries');

// Step 4: orders confirmed
for (const [label, order, payment] of [
  ['A', orderA, payA],
  ['B', orderB, payB],
]) {
  const { status, json } = await call('orders', 'GET', `${GATEWAY}/v1/orders/${order.id}`);
  expect(status === 200, `orders: get ${label} expected 200, got ${status}`);
  expect(
    json.status === 'CONFIRMED',
    `orders: ${label} status expected CONFIRMED, got ${json.status}`,
  );
  expect(
    json.paidTransactionId === payment.transaction.transactionId,
    `orders: ${label} paidTransactionId does not match the payment transaction`,
  );
}
console.log('4. both orders CONFIRMED with matching paidTransactionId');

// Step 5: accounts
{
  const { status, json } = await call('accounts', 'GET', `${GATEWAY}/v1/backoffice/accounts`, jwt);
  expect(status === 200, `accounts: expected 200, got ${status}`);
  expect(
    json.totals.debitMinor === 40000 && json.totals.creditMinor === 40000,
    `accounts: totals expected 40000/40000, got ${json.totals.debitMinor}/${json.totals.creditMinor}`,
  );
  const balance = (code) => json.data.find((a) => a.code === code)?.balanceMinor;
  expect(
    balance('1100') === 40000,
    `accounts: 1100 balance expected 40000, got ${balance('1100')}`,
  );
  expect(
    balance('4000') === 40000,
    `accounts: 4000 balance expected 40000, got ${balance('4000')}`,
  );
  expect(balance('2100') === 0, `accounts: 2100 balance expected 0, got ${balance('2100')}`);
}
console.log('5. accounts balanced: debit = credit = 40000');

console.log('SMOKE OK');
