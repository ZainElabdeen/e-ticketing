import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACCEPT,
  describeKinds,
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

test('findMissingImages returns the images without the tag', async () => {
  const calls = [];
  const missing = await findMissingImages({
    tag: 'sha-abc1234',
    fetchImpl: fakeFetch(['web', 'migrate-ledger'], calls),
  });
  assert.deepEqual(missing.sort(), ['migrate-ledger', 'web']);
  const heads = calls.filter((c) => c.init.method === 'HEAD');
  assert.equal(heads.length, 8);
  assert.equal(heads[0].init.headers.Authorization, 'Bearer fake-token');
  assert.equal(heads[0].init.headers.Accept, ACCEPT);
});

test('findMissingImages returns [] when all exist', async () => {
  assert.deepEqual(await findMissingImages({ tag: 'sha-abc1234', fetchImpl: fakeFetch([]) }), []);
});

test('a token failure counts as missing and does not leak the token', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const missing = await findMissingImages({ tag: 'sha-abc1234', fetchImpl });
  assert.equal(missing.length, 8);
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
