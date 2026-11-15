import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACCEPT,
  describeKinds,
  describeWorkloads,
  findMissingImages,
  imageNames,
  manifestUrl,
  tokenUrl,
  validateTag,
} from './ghcr.mjs';

test('imageNames reads the eight names from .github/images.json', () => {
  assert.deepEqual(imageNames().sort(), [
    'gateway',
    'ledger-service',
    'migrate-ledger',
    'migrate-payments',
    'migrate-tickets',
    'payment-service',
    'ticket-service',
    'web',
  ]);
});

test('validateTag accepts sha-<7 hex> only', () => {
  assert.equal(validateTag('sha-abc1234'), 'sha-abc1234');
  for (const bad of ['latest', 'sha-ABC1234', 'sha-abc123', 'sha-abc12345', '', undefined]) {
    assert.throws(() => validateTag(bad), /sha-/);
  }
});

test('URLs and Accept header', () => {
  assert.equal(
    tokenUrl('gateway'),
    'https://ghcr.io/token?scope=repository:zainelabdeen/e-ticketing/gateway:pull',
  );
  assert.equal(
    manifestUrl('gateway', 'sha-abc1234'),
    'https://ghcr.io/v2/zainelabdeen/e-ticketing/gateway/manifests/sha-abc1234',
  );
  assert.match(ACCEPT, /application\/vnd\.oci\.image\.index\.v1\+json/);
  assert.match(ACCEPT, /application\/vnd\.docker\.distribution\.manifest\.list\.v2\+json/);
});

function fakeFetch(missing, calls = []) {
  return async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const u = String(url);
    if (u.startsWith('https://ghcr.io/token')) {
      return { ok: true, status: 200, json: async () => ({ token: 'fake-token' }) };
    }
    const name = u.split('/e-ticketing/')[1].split('/manifests/')[0];
    const status = missing.includes(name) ? 404 : 200;
    return { ok: status === 200, status };
  };
}

test('findMissingImages separates 404 from other failures', async () => {
  const calls = [];
  const { missing, failed } = await findMissingImages({
    tag: 'sha-abc1234',
    fetchImpl: fakeFetch(['web', 'migrate-ledger'], calls),
  });
  assert.deepEqual(missing.sort(), ['migrate-ledger', 'web']);
  assert.deepEqual(failed, []);
  const heads = calls.filter((c) => c.init.method === 'HEAD');
  assert.equal(heads.length, 8);
  assert.equal(heads[0].init.headers.Authorization, 'Bearer fake-token');
  assert.equal(heads[0].init.headers.Accept, ACCEPT);
  assert.ok(heads[0].init.signal instanceof AbortSignal);
});

test('all present gives no missing and no failed', async () => {
  const r = await findMissingImages({ tag: 'sha-abc1234', fetchImpl: fakeFetch([]) });
  assert.deepEqual(r, { missing: [], failed: [] });
});

test('a 500 on the manifest is a failure, not missing', async () => {
  const fetchImpl = async (url) =>
    String(url).includes('/token')
      ? { ok: true, status: 200, json: async () => ({ token: 't' }) }
      : { ok: false, status: 500 };
  const r = await findMissingImages({ tag: 'sha-abc1234', fetchImpl });
  assert.equal(r.missing.length, 0);
  assert.equal(r.failed.length, 8);
  assert.match(r.failed[0].reason, /500/);
});

test('a token 401 or a thrown fetch is a failure', async () => {
  const r1 = await findMissingImages({
    tag: 'sha-abc1234',
    fetchImpl: async () => ({ ok: false, status: 401 }),
  });
  assert.equal(r1.failed.length, 8);
  assert.match(r1.failed[0].reason, /401/);
  const r2 = await findMissingImages({
    tag: 'sha-abc1234',
    fetchImpl: async () => {
      throw new TypeError('network down');
    },
  });
  assert.equal(r2.failed.length, 8);
  assert.equal(r2.failed[0].reason, 'TypeError');
  assert.equal(r2.missing.length, 0);
});

test('describeWorkloads keeps only Deployments and StatefulSets', () => {
  const yaml = [
    'kind: Service',
    'metadata:',
    '  name: a',
    '---',
    'kind: Deployment',
    'metadata:',
    '  name: gateway',
    '---',
    'kind: StatefulSet',
    'metadata:',
    '  name: postgres',
    '---',
    'kind: CronJob',
    'metadata:',
    '  name: backup',
  ].join('\n');
  assert.deepEqual(describeWorkloads(yaml), ['Deployment/gateway', 'StatefulSet/postgres']);
});

test('describeKinds lists kind/name of each document', () => {
  const yaml = [
    'apiVersion: v1',
    'kind: Namespace',
    'metadata:',
    '  name: eticketing',
    '---',
    'apiVersion: apps/v1',
    'kind: Deployment',
    'metadata:',
    '  name: gateway',
    '  namespace: eticketing',
    'spec: {}',
  ].join('\n');
  assert.deepEqual(describeKinds(yaml), ['Namespace/eticketing', 'Deployment/gateway']);
});
