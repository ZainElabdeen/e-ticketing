import { pathToFileURL } from 'node:url';
import { assertGateway } from './gateway-target.mjs';

// Real demo purchases through the public Gateway API. Node global fetch only.
// Never prints a card number or a secret.
const VISA = '4242424242424242';
const MASTERCARD = '5555555555554444';
const card = (number, holder) => ({ number, expMonth: 12, expYear: 2030, cvc: '123', holder });

export const purchasePlan = [
  {
    items: [{ ticketTypeCode: 'GOLD', quantity: 2 }],
    method: 'CARD',
    card: card(VISA, 'Demo Visa'),
  },
  {
    items: [{ ticketTypeCode: 'PREMIUM', quantity: 1 }],
    method: 'CARD',
    card: card(MASTERCARD, 'Demo Mastercard'),
  },
  { items: [{ ticketTypeCode: 'VIP', quantity: 1 }], method: 'QR' },
  {
    items: [
      { ticketTypeCode: 'GOLD', quantity: 1 },
      { ticketTypeCode: 'PREMIUM', quantity: 1 },
    ],
    method: 'CARD',
    card: card(VISA, 'Demo Visa'),
  },
];

export const formatAed = (minor) =>
  `AED ${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const itemsLabel = (items) => items.map((i) => `${i.ticketTypeCode}×${i.quantity}`).join(' + ');
const methodLabel = (p) => (p.method === 'CARD' ? `card ending ${p.card.number.slice(-4)}` : 'QR');

export const describePlan = (plan) =>
  plan.map((p, i) => `#${i + 1} ${itemsLabel(p.items)} ${methodLabel(p)}`);

export const planTotals = (plan, prices) => {
  let minor = 0;
  let tickets = 0;
  for (const p of plan)
    for (const it of p.items) {
      minor += prices[it.ticketTypeCode] * it.quantity;
      tickets += it.quantity;
    }
  return { minor, tickets };
};

function fail(message) {
  console.error(`SEED FAILED: ${message}`);
  process.exit(1);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  if (process.argv.includes('--dry-run')) {
    console.log('Dry run, no requests sent. Plan:');
    for (const line of describePlan(purchasePlan)) console.log(line);
    console.log('SEED DRY RUN OK');
    return;
  }

  const GATEWAY =
    process.env.SEED_GATEWAY_URL ?? `http://127.0.0.1:${process.env.GATEWAY_HOST_PORT ?? 3000}`;
  await assertGateway(GATEWAY);

  async function call(step, method, path, body, headers = {}) {
    for (let attempt = 0; ; attempt += 1) {
      let res;
      try {
        res = await fetch(`${GATEWAY}${path}`, {
          method,
          headers: { 'content-type': 'application/json', ...headers },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(10_000),
        });
      } catch (err) {
        fail(`${step}: ${method} ${path} failed: ${err.message}`);
      }
      if (res.status === 429 && attempt < 3) {
        const wait = Number(res.headers.get('retry-after')) || 5;
        console.log(`${step}: rate limited, waiting ${wait}s`);
        await sleep(wait * 1000);
        continue;
      }
      const text = await res.text();
      let json;
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch {
        fail(`${step}: ${method} ${path} returned non-JSON (HTTP ${res.status})`);
      }
      return { status: res.status, json };
    }
  }

  const poll = async (step, path, done, what) => {
    let last;
    for (let i = 0; i < 30; i += 1) {
      const { status, json } = await call(step, 'GET', path);
      if (status !== 200) fail(`${step}: poll ${path} expected 200, got ${status}`);
      last = json;
      if (done(json)) return json;
      await sleep(1000);
    }
    return fail(`${step}: ${what} still ${last?.status} after 30 s`);
  };

  const rows = [];
  for (const [i, p] of purchasePlan.entries()) {
    const step = `#${i + 1}`;
    const order = await call(step, 'POST', '/v1/orders', { items: p.items });
    if (order.status !== 201) fail(`${step}: create order expected 201, got ${order.status}`);
    const payBody = {
      orderId: order.json.id,
      method: p.method,
      ...(p.card ? { card: p.card } : {}),
    };
    const created = await call(step, 'POST', '/v1/payments', payBody, {
      'idempotency-key': crypto.randomUUID(),
    });
    if (created.status !== 200 && created.status !== 201)
      fail(`${step}: create payment expected 2xx, got ${created.status}`);
    let payment = created.json;
    if (p.method === 'QR')
      payment = await poll(
        step,
        `/v1/payments/${payment.id}`,
        (j) => j.status === 'SUCCEEDED',
        'payment',
      );
    if (payment.status !== 'SUCCEEDED') fail(`${step}: payment status ${payment.status}`);
    const confirmed = await poll(
      step,
      `/v1/orders/${order.json.id}`,
      (j) => j.status === 'CONFIRMED',
      'order',
    );
    const ref = payment.transaction?.paymentReference ?? 'no-reference';
    console.log(
      `${step} ${itemsLabel(p.items)} ${p.method === 'CARD' ? 'card' : 'qr'} ` +
        `${formatAed(order.json.totalMinor)} ${ref} ${confirmed.status}`,
    );
    rows.push({
      minor: order.json.totalMinor,
      tickets: p.items.reduce((n, it) => n + it.quantity, 0),
    });
  }

  const types = await call('ticket-types', 'GET', '/v1/ticket-types');
  if (types.status !== 200) fail(`ticket-types: expected 200, got ${types.status}`);
  const minor = rows.reduce((n, r) => n + r.minor, 0);
  const tickets = rows.reduce((n, r) => n + r.tickets, 0);
  console.log(`Tickets bought: ${tickets}`);
  console.log(`Charged: ${formatAed(minor)}`);
  for (const t of types.json.data) console.log(`Available ${t.code}: ${t.available}/${t.quota}`);
  console.log('SEED OK');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
