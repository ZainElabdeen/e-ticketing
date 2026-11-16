import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { isDnsName, renderHelmChartConfig, renderProd } from './render-prod.mjs';

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

const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
const overlayArgs = ['--host', 'demo.example.org', '--tag', 'sha-abc1234'];
const traefikFile = join(k8sDir, '.rendered/traefik-config.yaml');

test('each --target writes kustomization.yaml to its fixed directory', () => {
  const fixed = {
    prod: join(k8sDir, 'overlays/prod'),
    k3d: join(k8sDir, '.rendered/k3d'),
    validate: join(k8sDir, '.rendered/validate'),
  };
  for (const [target, dir] of Object.entries(fixed)) {
    const file = join(dir, 'kustomization.yaml');
    const existed = existsSync(file);
    try {
      execFileSync(process.execPath, [script, '--target', target, ...overlayArgs], {
        stdio: 'pipe',
      });
      assert.match(readFileSync(file, 'utf8'), /sha-abc1234/, target);
    } finally {
      if (target !== 'prod') rmSync(dir, { recursive: true, force: true });
      else if (!existed) rmSync(file, { force: true });
    }
  }
});

test('an unknown --target exits 2 and writes nothing', () => {
  for (const target of ['staging', '../x', '/tmp/render-prod-x', '', 'Prod']) {
    const r = run('--target', target, ...overlayArgs);
    assert.equal(r.status, 2, target);
    assert.match(r.stderr, /--target must be one of prod, k3d, validate/);
  }
  assert.equal(existsSync('/tmp/render-prod-x'), false);
  const none = run(...overlayArgs);
  assert.equal(none.status, 2);
});

test('--traefik writes the fixed file and prints its path', () => {
  try {
    const r = run('--traefik', '--acme-email', 'ops@example.org');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), traefikFile);
    assert.match(readFileSync(traefikFile, 'utf8'), /email: ops@example\.org/);
  } finally {
    rmSync(traefikFile, { force: true });
  }
});

test('--traefik rejects a bad email and mixing with overlay options', () => {
  assert.equal(run('--traefik', '--acme-email', 'nope').status, 1);
  assert.equal(run('--traefik').status, 1);
  assert.equal(run('--traefik', '--target', 'prod', '--acme-email', 'ops@example.org').status, 1);
  assert.equal(run('--target', 'k3d', '--acme-email', 'ops@example.org').status, 1);
});

test('--out and --traefik-out are rejected as unknown options', () => {
  for (const flag of ['--out', '--traefik-out']) {
    const r = run('--target', 'k3d', ...overlayArgs, flag, '/tmp/render-prod-x');
    assert.equal(r.status, 1, flag);
    assert.match(r.stderr, /Unknown option/);
  }
  assert.equal(existsSync('/tmp/render-prod-x'), false);
});

test('a bad host fails with exit 1', () => {
  const r = run('--target', 'k3d', '--host', 'nope', '--tag', 'sha-abc1234');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /render-prod: HOST must be/);
});

test('a symlink planted at the fixed file is rejected and not written through', () => {
  const victim = join(k8sDir, '.rendered', `victim-${process.pid}.txt`);
  try {
    mkdirSync(join(k8sDir, '.rendered'), { recursive: true });
    symlinkSync(victim, traefikFile);
    const r = run('--traefik', '--acme-email', 'ops@example.org');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /symbolic link/);
    assert.equal(existsSync(victim), false);
  } finally {
    rmSync(traefikFile, { force: true });
  }
});
