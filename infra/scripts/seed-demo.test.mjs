import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatAed, purchasePlan, describePlan, planTotals, renderRow } from './seed-demo.mjs';

test('plan totals', () => {
  const totals = planTotals(purchasePlan, { GOLD: 10000, PREMIUM: 20000, VIP: 50000 });
  assert.equal(totals.minor, 120000);
  assert.equal(formatAed(totals.minor), 'AED 1,200.00');
  assert.equal(totals.tickets, 6);
});

test('formatAed formats minor units', () => {
  assert.equal(formatAed(120000), 'AED 1,200.00');
  assert.equal(formatAed(20000), 'AED 200.00');
  assert.equal(formatAed(5), 'AED 0.05');
});

test('no card number in rendered lines', () => {
  const text = describePlan(purchasePlan).join('\n');
  for (const p of purchasePlan) {
    if (p.card) {
      assert.ok(!text.includes(p.card.number));
    }
  }
  assert.match(text, /card ending 4242/);
  const rows = purchasePlan.map((p, i) =>
    renderRow(`#${i + 1}`, p, 20000, 'PAY-20261115-8XBXWP', 'CONFIRMED'),
  );
  for (const line of [...describePlan(purchasePlan), ...rows]) {
    assert.doesNotMatch(line.replace(/[\s-]/g, ''), /\d{12,19}/);
  }
});
