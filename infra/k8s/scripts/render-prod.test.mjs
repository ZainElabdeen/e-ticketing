import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  checkOutDir,
  checkTraefikOut,
  isDnsName,
  renderHelmChartConfig,
  renderProd,
} from './render-prod.mjs';

const script = fileURLToPath(new URL('./render-prod.mjs', import.meta.url));
const k8sDir = fileURLToPath(new URL('..', import.meta.url));

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
  const rendered = join(k8sDir, '.rendered', `render-prod-test-${process.pid}`);
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
        rendered,
        '--acme-email',
        'ops@example.org',
        '--traefik-out',
        join(dir, 't.yaml'),
      ],
      { stdio: 'pipe' },
    );
    assert.match(readFileSync(join(rendered, 'kustomization.yaml'), 'utf8'), /sha-abc1234/);
    assert.match(readFileSync(join(dir, 't.yaml'), 'utf8'), /ops@example\.org/);
    const bad = spawnSync(
      process.execPath,
      [script, '--host', 'nope', '--tag', 'sha-abc1234', '--out', rendered],
      { encoding: 'utf8' },
    );
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /render-prod: HOST must be/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(rendered, { recursive: true, force: true });
  }
});

test('--out is limited to two levels below infra/k8s', () => {
  assert.doesNotThrow(() => checkOutDir(join(k8sDir, 'overlays/prod')));
  assert.doesNotThrow(() => checkOutDir(join(k8sDir, '.rendered/anything')));
  for (const bad of [
    '/etc/cron.d',
    join(tmpdir(), 'x'),
    join(k8sDir, 'overlays/prod/..'),
    join(k8sDir, '.rendered/a/b'),
    join(k8sDir, '.rendered'),
    join(k8sDir, '.rendered/../../../etc'),
    k8sDir,
  ]) {
    assert.throws(() => checkOutDir(bad), /--out must be/, bad);
  }
});

test('--out rejects a symlink that leaves infra/k8s', () => {
  const outside = mkdtempSync(join(tmpdir(), 'render-prod-out-'));
  const link = join(k8sDir, '.rendered', `link-${process.pid}`);
  try {
    mkdirSync(join(k8sDir, '.rendered'), { recursive: true });
    symlinkSync(outside, link);
    assert.throws(() => checkOutDir(link), /--out must be/);
  } finally {
    rmSync(link, { force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('--traefik-out is limited to .yaml files in the temp dir or .rendered', () => {
  assert.doesNotThrow(() => checkTraefikOut(join(tmpdir(), 't.yaml')));
  assert.doesNotThrow(() => checkTraefikOut(join(k8sDir, '.rendered/traefik/t.yaml')));
  for (const bad of [
    '/etc/passwd',
    '/etc/cron.d/x.yaml',
    join(tmpdir(), 't.txt'),
    join(tmpdir(), '../etc/x.yaml'),
    join(k8sDir, 'traefik/helmchartconfig.yaml'),
    join(k8sDir, 'overlays/prod/x.yaml'),
  ]) {
    assert.throws(() => checkTraefikOut(bad), /--traefik-out must be/, bad);
  }
});

test('--traefik-out rejects a symlinked directory pointing outside', () => {
  const outside = mkdtempSync(join(k8sDir, 'render-prod-sym-'));
  const dir = mkdtempSync(join(tmpdir(), 'render-prod-link-'));
  try {
    symlinkSync(outside, join(dir, 'ln'));
    assert.throws(() => checkTraefikOut(join(dir, 'ln/t.yaml')), /--traefik-out must be/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('CLI exits 1 on a rejected path and writes nothing', () => {
  const r = spawnSync(
    process.execPath,
    [script, '--host', 'demo.example.org', '--tag', 'sha-abc1234', '--out', '/tmp/render-prod-x'],
    { encoding: 'utf8' },
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /render-prod: --out must be/);
});

test('CLI accepts --traefik-out alone (deploy.sh drift hint)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'render-prod-alone-'));
  try {
    execFileSync(
      process.execPath,
      [
        script,
        '--host',
        'demo.example.org',
        '--tag',
        'sha-abc1234',
        '--acme-email',
        'ops@example.org',
        '--traefik-out',
        join(dir, 't.yaml'),
      ],
      { stdio: 'pipe' },
    );
    assert.match(readFileSync(join(dir, 't.yaml'), 'utf8'), /ops@example\.org/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
