import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildArgsText, selectImages } from './select-images.mjs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const images = JSON.parse(read('../images.json'));
const names = images.map((i) => i.name);
const filters = read('../filters.yml');

// Top-level filter blocks: key -> body text. Parsed by line, no YAML dependency.
function blocks(text) {
  const out = {};
  let key = null;
  for (const line of text.split('\n')) {
    const m = /^([a-z-]+):/.exec(line);
    if (m) {
      key = m[1];
      out[key] = '';
    } else if (key) {
      out[key] += `${line}\n`;
    }
  }
  return out;
}
const filterBlocks = blocks(filters);
const nodeServices = ['payment-service', 'ledger-service', 'gateway'];

test('all=true returns every image in images.json order', () => {
  assert.equal(names.length, 8);
  assert.deepEqual(
    selectImages([], true, images).map((i) => i.name),
    names,
  );
});

test('changed names come back in images.json order, not input order', () => {
  assert.deepEqual(
    selectImages(['web', 'gateway'], false, images).map((i) => i.name),
    ['gateway', 'web'],
  );
});

test('no changes selects nothing', () => {
  assert.deepEqual(selectImages([], false, images), []);
});

test('unknown names are ignored', () => {
  assert.deepEqual(selectImages(['node-shared', 'nope'], false, images), []);
});

test('buildArgsText is KEY=VALUE per line', () => {
  assert.equal(buildArgsText({ buildArgs: { A: '1', B: 'x' } }), 'A=1\nB=x');
  assert.equal(buildArgsText({ buildArgs: {} }), '');
  assert.equal(buildArgsText({}), '');
});

test('images.json and filters.yml have the same names', () => {
  const keys = Object.keys(filterBlocks).filter((k) => k !== 'node-shared');
  assert.deepEqual([...keys].sort(), [...names].sort());
});

test('every image dockerfile exists', () => {
  for (const i of images) {
    assert.doesNotThrow(
      () => readFileSync(new URL(`../../${i.dockerfile}`, import.meta.url)),
      i.name,
    );
  }
});

test('node services include the node-shared paths', () => {
  const shared = filterBlocks['node-shared'];
  for (const p of [
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'packages/**',
    'infra/docker/nest-service.Dockerfile',
    '.dockerignore',
    '.github/workflows/images.yml',
    '.github/images.json',
  ]) {
    assert.ok(shared.includes(`'${p}'`), `node-shared lacks ${p}`);
  }
  for (const n of nodeServices) {
    assert.ok(filterBlocks[n].includes('- *node-shared'), `${n} lacks *node-shared`);
    assert.ok(filterBlocks[n].includes(`'apps/${n}/**'`), `${n} lacks own path`);
  }
});

test('every filter watches the workflow and images.json', () => {
  for (const n of names) {
    const body = nodeServices.includes(n) ? filterBlocks['node-shared'] : filterBlocks[n];
    assert.ok(body.includes("'.github/workflows/images.yml'"), n);
    assert.ok(body.includes("'.github/images.json'"), n);
  }
});

test('migrate prisma pin matches the apps and the lockfile', () => {
  const read = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
  const pin = read('../../infra/migrate/package.json').dependencies.prisma;
  const lock = read('../../infra/migrate/package-lock.json');
  assert.equal(lock.packages['node_modules/prisma'].version, pin);
  for (const app of ['ticket-service', 'payment-service', 'ledger-service']) {
    const pkg = read(`../../apps/${app}/package.json`);
    assert.equal((pkg.dependencies?.prisma ?? pkg.devDependencies?.prisma).replace(/^[\^~]/, ''), pin, app);
  }
});

// Filter body with `- *node-shared` expanded, so path checks see what paths-filter sees.
function expanded(name) {
  const body = filterBlocks[name];
  return body.includes('- *node-shared') ? body + filterBlocks['node-shared'] : body;
}

test('COPY . . images watch every workspace package their app depends on', () => {
  let checked = 0;
  for (const image of images) {
    const dockerfile = readFileSync(new URL(`../../${image.dockerfile}`, import.meta.url), 'utf8');
    if (!/^COPY \. \./m.test(dockerfile)) continue;
    const app = image.buildArgs.SERVICE ?? image.name;
    const pkg = JSON.parse(read(`../../apps/${app}/package.json`));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const workspaceDeps = Object.entries(deps)
      .filter(([, v]) => v === 'workspace:*')
      .map(([n]) => n.replace('@eticket/', ''));
    assert.ok(workspaceDeps.length > 0, `${image.name} has no workspace deps?`);
    for (const dep of workspaceDeps) {
      const body = expanded(image.name);
      assert.ok(
        body.includes(`'packages/${dep}/**'`) || body.includes("'packages/**'"),
        `${image.name} filter lacks packages/${dep}/**`,
      );
    }
    checked++;
  }
  assert.ok(checked >= 4, 'expected the web and nest images to be checked');
});
