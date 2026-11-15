import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { isDnsName, renderHelmChartConfig, renderProd } from './render-prod.mjs';

const script = fileURLToPath(new URL('./render-prod.mjs', import.meta.url));

test('renderProd fills every host and tag placeholder', () => {
  const out = renderProd({ host: 'demo.example.org', tag: 'sha-abc1234' });
  assert.doesNotMatch(out, /\$\{/);
  assert.match(out, /newTag: 'sha-abc1234'/);
  assert.match(out, /value: 'https:\/\/demo\.example\.org'/);
  assert.equal(out.match(/newTag: 'sha-abc1234'/g).length, 8);
});

test('renderProd rejects a bad host or tag without echoing it', () => {
  for (const host of [
    '',
    'localhost',
    'Demo.Example.org',
    'a b.example.org',
    'x..org',
    '-a.example.org',
    'a.example.org/',
    'a'.repeat(64) + '.org',
    undefined,
  ]) {
    assert.throws(() => renderProd({ host, tag: 'sha-abc1234' }), /HOST must be/, String(host));
  }
  for (const tag of ['latest', 'sha-ABC1234', 'sha-abc123', 'sha-abc12345', 'v1', '', undefined]) {
    assert.throws(() => renderProd({ host: 'demo.example.org', tag }), /TAG must/, String(tag));
  }
  assert.throws(
    () => renderProd({ host: 'bad host', tag: 'x' }),
    (e) => !e.message.includes('bad host'),
  );
});

test('isDnsName accepts subdomains and punycode, rejects single labels', () => {
  assert.equal(isDnsName('my-demo.duckdns.org'), true);
  assert.equal(isDnsName('xn--a.example.org'), true);
  assert.equal(isDnsName('localhost'), false);
});

test('renderHelmChartConfig fills the ACME email and keeps the Traefik settings', () => {
  const out = renderHelmChartConfig({ acmeEmail: 'ops@example.org' });
  assert.doesNotMatch(out, /\$\{/);
  assert.match(out, /email: ops@example\.org/);
  assert.match(out, /externalTrafficPolicy: Local/);
  assert.match(out, /httpChallenge:\n\s+entryPoint: web/);
  assert.match(out, /persistence:\n\s+enabled: true/);
});

test('renderHelmChartConfig rejects invalid emails', () => {
  for (const acmeEmail of [
    '',
    'nope',
    'a@b',
    'a b@example.org',
    'a@@example.org',
    "a'@example.org",
    'a@example.org\nfoo: bar',
    undefined,
  ]) {
    assert.throws(
      () => renderHelmChartConfig({ acmeEmail }),
      /ACME_EMAIL must be/,
      String(acmeEmail),
    );
  }
});

test('CLI writes kustomization.yaml and the Traefik config, and fails on bad input', () => {
  const dir = mkdtempSync(join(tmpdir(), 'render-prod-'));
  try {
    execFileSync(
      process.execPath,
      [
        script,
        '--host',
        'demo.example.org',
        '--tag',
        'sha-abc1234',
        '--out',
        join(dir, 'o'),
        '--acme-email',
        'ops@example.org',
        '--traefik-out',
        join(dir, 't.yaml'),
      ],
      { stdio: 'pipe' },
    );
    assert.match(readFileSync(join(dir, 'o/kustomization.yaml'), 'utf8'), /sha-abc1234/);
    assert.match(readFileSync(join(dir, 't.yaml'), 'utf8'), /ops@example\.org/);
    const bad = spawnSync(
      process.execPath,
      [script, '--host', 'nope', '--tag', 'sha-abc1234', '--out', join(dir, 'x')],
      { encoding: 'utf8' },
    );
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /render-prod: HOST must be/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
