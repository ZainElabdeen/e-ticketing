import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, readFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatePassword, hashAdminPassword } from './lib/admin-hash-lib.mjs';
import { fillSecrets, parseEnv, pickPort, renderEnv } from './setup-local.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(here, 'setup-local.mjs');
const EXAMPLE = readFileSync(join(here, '..', '.env.example'), 'utf8');
const bcrypt = createRequire(join(here, '..', '..', 'apps', 'gateway', 'package.json'))('bcryptjs');
const PASSWORD = 'a-long-test-password';

const rand = (bytes) => 'ab'.repeat(bytes / 2 + (bytes % 2)).slice(0, bytes * 2);

function tempEnv() {
  return join(mkdtempSync(join(tmpdir(), 'setup-local-')), '.env');
}

function run(envPath, extra = [], input = '') {
  return spawnSync(process.execPath, [SCRIPT, '--env', envPath, '--no-ports', ...extra], {
    input,
    encoding: 'utf8',
  });
}

test('fills every placeholder secret from the example and leaves real values alone', () => {
  const values = parseEnv(EXAMPLE);
  values.set('TICKETS_APP_PASSWORD', 'already-real');
  const { values: out, generated } = fillSecrets(values, rand);
  assert.equal(out.get('TICKETS_APP_PASSWORD'), 'already-real');
  assert.ok(!generated.includes('TICKETS_APP_PASSWORD'));
  for (const key of [
    'POSTGRES_PASSWORD',
    'TICKETS_OWNER_PASSWORD',
    'LEDGER_APP_PASSWORD',
    'PUBLIC_API_KEY_TICKET',
    'INTERNAL_API_KEY_TICKET',
    'PUBLIC_API_KEY_PAYMENT',
    'INTERNAL_API_KEY_LEDGER',
    'PUBLIC_API_KEY_LEDGER',
    'JWT_SECRET',
  ]) {
    assert.ok(generated.includes(key), `${key} generated`);
    assert.doesNotMatch(out.get(key), /^(replace-with|change-me)/i);
  }
  assert.ok(!generated.includes('ADMIN_PASSWORD_DEV'));
  assert.equal(out.get('ADMIN_PASSWORD_DEV'), values.get('ADMIN_PASSWORD_DEV'));
});

test('generated values are hex of the required length', () => {
  const { values } = fillSecrets(parseEnv(EXAMPLE));
  assert.match(values.get('POSTGRES_PASSWORD'), /^[0-9a-f]{64}$/);
  assert.match(values.get('PUBLIC_API_KEY_TICKET'), /^[0-9a-f]{64}$/);
  assert.match(values.get('JWT_SECRET'), /^[0-9a-f]{96}$/);
});

test('keeps comments and key order of the example', () => {
  const { values } = fillSecrets(parseEnv(EXAMPLE));
  const out = renderEnv(EXAMPLE, values);
  const keys = (text) => [...text.matchAll(/^(?:# )?([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]);
  assert.deepEqual(keys(out), keys(EXAMPLE));
  assert.ok(out.startsWith(EXAMPLE.split('\n')[0]));
  assert.ok(out.includes('# Gateway (Phase 6).'));
});

test('optional commented keys become real lines only when set', () => {
  const base = fillSecrets(parseEnv(EXAMPLE)).values;
  assert.match(renderEnv(EXAMPLE, base), /^# GATEWAY_HOST_PORT=3000$/m);
  const withPort = new Map(base).set('GATEWAY_HOST_PORT', '3100');
  const out = renderEnv(EXAMPLE, withPort);
  assert.match(out, /^GATEWAY_HOST_PORT=3100$/m);
  assert.doesNotMatch(out, /^# GATEWAY_HOST_PORT=/m);
  assert.match(out, /^# WEB_HOST_PORT=8080$/m);
});

test('does not regenerate on a second run (idempotent)', () => {
  const env = tempEnv();
  const first = run(env, [], `${PASSWORD}\n`);
  assert.equal(first.status, 0, first.stderr);
  const before = readFileSync(env, 'utf8');
  const second = run(env);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(readFileSync(env, 'utf8'), before);
  assert.match(second.stdout, /Admin login unchanged/);
  assert.match(second.stdout, /docker compose -f infra\/docker-compose.yml up -d --build --wait/);
});

test('--reset-admin replaces only the three admin keys', () => {
  const env = tempEnv();
  assert.equal(run(env, [], `${PASSWORD}\n`).status, 0);
  const before = parseEnv(readFileSync(env, 'utf8'));
  const r = run(
    env,
    ['--reset-admin', '--password-stdin', '--email', 'other@eticket.local'],
    'another-long-password\n',
  );
  assert.equal(r.status, 0, r.stderr);
  const after = parseEnv(readFileSync(env, 'utf8'));
  const admin = ['ADMIN_EMAIL', 'ADMIN_PASSWORD_HASH_B64', 'ADMIN_PASSWORD_DEV'];
  for (const [key, value] of before) {
    if (admin.includes(key)) assert.notEqual(after.get(key), value, key);
    else assert.equal(after.get(key), value, key);
  }
  assert.equal(after.get('ADMIN_EMAIL'), 'other@eticket.local');
  assert.equal(after.get('ADMIN_PASSWORD_DEV'), 'another-long-password');
});

test('hashAdminPassword produces a base64 bcrypt hash that verifies', async () => {
  const b64 = await hashAdminPassword(PASSWORD);
  const hash = Buffer.from(b64, 'base64').toString('utf8');
  assert.match(hash, /^\$2[aby]\$12\$/);
  assert.equal(await bcrypt.compare(PASSWORD, hash), true);
});

test('password limits: over 72 bytes is rejected by the lib and the CLI, under 8 by the CLI', async () => {
  await assert.rejects(hashAdminPassword('x'.repeat(73)), /72/);
  await assert.rejects(hashAdminPassword('é'.repeat(37)), /72/);
  const env = tempEnv();
  const long = run(env, ['--password-stdin'], `${'x'.repeat(73)}\n`);
  assert.notEqual(long.status, 0);
  assert.equal(existsSync(env), false);
  const short = run(env, ['--password-stdin'], 'short\n');
  assert.notEqual(short.status, 0);
  assert.equal(existsSync(env), false);
});

test('generatePassword returns 20 characters from the unambiguous alphabet', () => {
  for (let i = 0; i < 50; i++) {
    const p = generatePassword();
    assert.equal(p.length, 20);
    assert.match(p, /^[A-HJ-NP-Za-km-z2-9]{20}$/);
  }
  assert.equal(generatePassword(30).length, 30);
});

test('non-TTY run writes the login file with mode 600 and does not print the password', () => {
  const env = tempEnv();
  const r = run(env, ['--password-stdin'], `${PASSWORD}\n`);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!(r.stdout + r.stderr).includes(PASSWORD));
  const file = join(dirname(env), '.admin-login.txt');
  assert.ok(r.stdout.includes(file));
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(statSync(env).mode & 0o777, 0o600);
  assert.ok(readFileSync(file, 'utf8').includes(PASSWORD));
  assert.ok(!r.stdout.includes('Password:'));
});

test('busy default port picks a free alternative', async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const busy = server.address().port;
  try {
    const picked = await pickPort(busy);
    assert.notEqual(picked, busy);
    assert.ok(picked >= busy + 100);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  assert.equal(await pickPort(busy), busy);
});
