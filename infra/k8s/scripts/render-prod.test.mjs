import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  isDnsName,
  renderHelmChartConfig,
  renderProd,
  writeOverlay,
  writeTraefikConfig,
} from './render-prod.mjs';

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

const overlayArgs = { host: 'demo.example.org', tag: 'sha-abc1234' };

/** Runs fn with a fresh temp root standing in for infra/k8s; the repo is never written. */
function withRoot(fn) {
  const root = mkdtempSync(join(tmpdir(), 'render-prod-root-'));
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const cli = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

test('each target writes kustomization.yaml to its fixed relative directory', () => {
  const fixed = { prod: 'overlays/prod', validate: '.rendered/validate' };
  for (const [target, rel] of Object.entries(fixed)) {
    withRoot((root) => {
      const file = writeOverlay(root, target, overlayArgs);
      assert.equal(file, join(root, rel, 'kustomization.yaml'), target);
      assert.match(readFileSync(file, 'utf8'), /sha-abc1234/, target);
    });
  }
});

test('an unknown target returns null and writes nothing', () => {
  for (const target of ['k3d', 'staging', '../x', '/tmp/render-prod-x', '', 'Prod', undefined]) {
    withRoot((root) => {
      assert.equal(writeOverlay(root, target, overlayArgs), null, String(target));
      assert.equal(existsSync(join(root, '.rendered')), false);
      assert.equal(existsSync(join(root, 'overlays')), false);
    });
  }
});

test('the CLI exits 2 on an unknown or missing target without writing', () => {
  for (const args of [['--target', 'k3d'], ['--target', '/tmp/render-prod-x'], []]) {
    const r = cli(...args, '--host', 'demo.example.org', '--tag', 'sha-abc1234');
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, /--target must be one of prod, validate/);
  }
  assert.equal(existsSync('/tmp/render-prod-x'), false);
});

test('writeTraefikConfig writes the fixed file under .rendered', () => {
  withRoot((root) => {
    const file = writeTraefikConfig(root, { acmeEmail: 'ops@example.org' });
    assert.equal(file, join(root, '.rendered/traefik-config.yaml'));
    assert.match(readFileSync(file, 'utf8'), /email: ops@example\.org/);
  });
});

test('writeTraefikConfig and writeOverlay reject bad input and write nothing', () => {
  withRoot((root) => {
    assert.throws(() => writeTraefikConfig(root, { acmeEmail: 'nope' }), /ACME_EMAIL must be/);
    assert.throws(() => writeOverlay(root, 'prod', { host: 'nope', tag: 'sha-abc1234' }), /HOST/);
    assert.equal(existsSync(join(root, '.rendered')), false);
    assert.equal(existsSync(join(root, 'overlays')), false);
  });
});

test('CLI argument validation fails with exit 1 (no file is written)', () => {
  assert.equal(cli('--traefik').status, 1);
  assert.equal(cli('--traefik', '--acme-email', 'ops@example.org', '--target', 'prod').status, 1);
  assert.equal(cli('--target', 'validate', '--acme-email', 'ops@example.org').status, 1);
  const bad = cli('--target', 'validate', '--host', 'nope', '--tag', 'sha-abc1234');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /render-prod: HOST must be/);
});

test('--out and --traefik-out are rejected as unknown options', () => {
  for (const flag of ['--out', '--traefik-out']) {
    const r = cli(
      '--target',
      'validate',
      '--host',
      'demo.example.org',
      '--tag',
      'sha-abc1234',
      flag,
      '/tmp/render-prod-x',
    );
    assert.equal(r.status, 1, flag);
    assert.match(r.stderr, /nknown option/);
  }
  assert.equal(existsSync('/tmp/render-prod-x'), false);
});

test('a symlink planted at a fixed file is rejected and not written through', () => {
  withRoot((root) => {
    const victim = join(root, 'victim.txt');
    mkdirSync(join(root, '.rendered'), { recursive: true });
    symlinkSync(victim, join(root, '.rendered/traefik-config.yaml'));
    assert.throws(
      () => writeTraefikConfig(root, { acmeEmail: 'ops@example.org' }),
      /symbolic link/,
    );
    mkdirSync(join(root, '.rendered/validate'), { recursive: true });
    symlinkSync(victim, join(root, '.rendered/validate/kustomization.yaml'));
    assert.throws(() => writeOverlay(root, 'validate', overlayArgs), /symbolic link/);
    assert.equal(existsSync(victim), false);
  });
});
