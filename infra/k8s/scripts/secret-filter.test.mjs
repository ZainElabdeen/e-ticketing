import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ALLOW_LIST, filterSecrets } from './secret-filter.mjs';

const script = fileURLToPath(new URL('./secret-filter.mjs', import.meta.url));

function fakeEnv(overrides = {}) {
  const values = Object.fromEntries(
    ALLOW_LIST.map((key) => [key, key.endsWith('_PASSWORD') ? 'Abc.123_x~y-z' : `val-${key}`]),
  );
  return Object.entries({ ...values, ...overrides })
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}

test('allow-list is exactly the 15 keys', () => {
  assert.equal(ALLOW_LIST.length, 15);
  assert.ok(ALLOW_LIST.includes('ADMIN_PASSWORD_HASH_B64'));
  assert.ok(!ALLOW_LIST.includes('ADMIN_PASSWORD_DEV'));
});

test('keeps only allow-listed keys and drops local, deploy keys, comments and blanks', () => {
  const text = [
    '# comment',
    '',
    fakeEnv(),
    'ADMIN_PASSWORD_DEV=hunter2',
    'GATEWAY_HOST_PORT=3100',
    'HOST=demo.example.org',
    'ACME_EMAIL=a@example.org',
  ].join('\n');
  const { lines, errors } = filterSecrets(text);
  assert.deepEqual(errors, []);
  assert.equal(lines.length, 15);
  const keys = lines.map((l) => l.split('=')[0]).sort();
  assert.deepEqual(keys, [...ALLOW_LIST].sort());
});

test('reports a missing key by name', () => {
  const { errors } = filterSecrets(fakeEnv({ JWT_SECRET: undefined }));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /JWT_SECRET/);
});

test('reports an empty value as missing', () => {
  const { errors } = filterSecrets(fakeEnv({ JWT_SECRET: '' }));
  assert.match(errors.join('\n'), /JWT_SECRET/);
});

test('rejects a *_PASSWORD value with a URL-unsafe character, naming only the key', () => {
  const bad = 'p@ss/word:SECRETVALUE';
  const { errors } = filterSecrets(fakeEnv({ TICKETS_OWNER_PASSWORD: bad }));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /TICKETS_OWNER_PASSWORD/);
  assert.ok(!errors[0].includes(bad));
});

test('does not apply the password charset to other keys', () => {
  const { errors } = filterSecrets(fakeEnv({ ADMIN_EMAIL: 'admin+x@example.org' }));
  assert.deepEqual(errors, []);
});

test('rejects placeholders', () => {
  for (const placeholder of ['replace-with-a-long-secret', 'change-me-now']) {
    const { errors } = filterSecrets(fakeEnv({ JWT_SECRET: placeholder }));
    assert.match(errors.join('\n'), /JWT_SECRET/);
    assert.ok(!errors.join('\n').includes(placeholder));
  }
});

test('no error message ever contains a value', () => {
  const text = fakeEnv({
    POSTGRES_PASSWORD: 'bad value!',
    JWT_SECRET: 'change-me',
    ADMIN_EMAIL: undefined,
  });
  const { errors } = filterSecrets(text);
  assert.ok(errors.length >= 3);
  for (const e of errors) {
    assert.ok(!e.includes('bad value'));
    assert.ok(!e.includes('change-me'));
  }
});

test('strips surrounding quotes and tolerates CRLF', () => {
  const { lines, errors } = filterSecrets(
    fakeEnv({ ADMIN_EMAIL: '"a@example.org"' }).replaceAll('\n', '\r\n'),
  );
  assert.deepEqual(errors, []);
  assert.ok(lines.includes('ADMIN_EMAIL=a@example.org'));
});

test('CLI writes the filtered file and exits 0; exits 1 with key names on error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'secret-filter-'));
  try {
    const input = join(dir, 'in.env');
    const output = join(dir, 'out.env');
    writeFileSync(input, `${fakeEnv()}\nADMIN_PASSWORD_DEV=hunter2\n`);
    const ok = spawnSync('node', [script, input, output], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    const written = readFileSync(output, 'utf8');
    assert.doesNotMatch(written, /ADMIN_PASSWORD_DEV|hunter2/);
    assert.equal(written.trim().split('\n').length, 15);

    writeFileSync(input, fakeEnv({ JWT_SECRET: undefined, POSTGRES_PASSWORD: 'bad value!' }));
    const bad = spawnSync('node', [script, input, join(dir, 'out2.env')], { encoding: 'utf8' });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /JWT_SECRET/);
    assert.match(bad.stderr, /POSTGRES_PASSWORD/);
    assert.ok(!bad.stderr.includes('bad value'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
