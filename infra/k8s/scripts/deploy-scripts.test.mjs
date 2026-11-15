import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ALLOW_LIST } from './secret-filter.mjs';

const apply = fileURLToPath(new URL('./apply-secrets.sh', import.meta.url));
const deploy = fileURLToPath(new URL('./deploy.sh', import.meta.url));

function withEnv(text, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-scripts-'));
  try {
    const file = join(dir, 'k8s.env');
    writeFileSync(file, text);
    return fn(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const validEnv = `${ALLOW_LIST.map((k) => `${k}=${k.endsWith('_PASSWORD') ? 'Abc.123' : 'v-' + k}`).join('\n')}\nADMIN_PASSWORD_DEV=hunter2\nHOST=demo.example.org\n`;

test('apply-secrets --dry-run lists only allow-listed key names', () => {
  withEnv(validEnv, (file) => {
    const r = spawnSync('bash', [apply, '--dry-run'], {
      encoding: 'utf8',
      env: { ...process.env, K8S_ENV_FILE: file },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /JWT_SECRET/);
    assert.doesNotMatch(r.stdout, /ADMIN_PASSWORD_DEV|HOST|hunter2|Abc\.123|v-JWT/);
  });
});

test('apply-secrets fails naming the key, never the value', () => {
  withEnv(validEnv.replace('Abc.123', 'bad value!'), (file) => {
    const r = spawnSync('bash', [apply, '--dry-run'], {
      encoding: 'utf8',
      env: { ...process.env, K8S_ENV_FILE: file },
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /_PASSWORD/);
    assert.doesNotMatch(r.stderr, /bad value/);
  });
});

test('deploy.sh rejects a bad or missing tag before touching anything', () => {
  for (const args of [
    [],
    ['latest'],
    ['sha-ABC1234'],
    ['sha-abc1234', 'extra'],
    ['sha-abc1234', '--dry-run', 'x'],
    ['sha-abc1234', '--apply'],
  ]) {
    const r = spawnSync('bash', [deploy, ...args], { encoding: 'utf8' });
    assert.equal(r.status, 2, `${args}`);
  }
});

test('deploy.sh fails clearly when HOST is not set', () => {
  withEnv(validEnv.replace('HOST=demo.example.org\n', ''), (file) => {
    const r = spawnSync('bash', [deploy, 'sha-abc1234', '--dry-run'], {
      encoding: 'utf8',
      env: { ...process.env, K8S_ENV_FILE: file },
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /HOST is not set/);
  });
});

test('ghcr.mjs workloads fails on YAML without workloads', () => {
  const ghcr = fileURLToPath(new URL('./ghcr.mjs', import.meta.url));
  const r = spawnSync('node', [ghcr, 'workloads'], {
    encoding: 'utf8',
    input: 'kind: Service\nmetadata:\n  name: a\n',
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no Deployment or StatefulSet/);
  const ok = spawnSync('node', [ghcr, 'workloads'], {
    encoding: 'utf8',
    input: 'kind: Deployment\nmetadata:\n  name: g\n',
  });
  assert.equal(ok.status, 0);
  assert.equal(ok.stdout.trim(), 'Deployment/g');
});
