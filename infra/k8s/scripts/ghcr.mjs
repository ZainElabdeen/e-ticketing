#!/usr/bin/env node
// Pure parts of deploy.sh: tag validation, image list, GHCR URLs, tag-exists check.
//
//   node ghcr.mjs check <sha-tag>          exit 1 naming each image missing the tag
//   node ghcr.mjs workloads                stdin: rendered YAML; prints Deployment/StatefulSet ids, exit 1 if none
//   node ghcr.mjs kinds                    stdin: rendered YAML; prints Kind/name lines
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseAllYaml } from './lib/yaml-lite.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const imagesJson = join(here, '../../../.github/images.json');
const REPO = 'zainelabdeen/e-ticketing';
const TAG = /^sha-[0-9a-f]{7}$/;

export const ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

export function imageNames() {
  return JSON.parse(readFileSync(imagesJson, 'utf8')).map((image) => image.name);
}

export function validateTag(tag) {
  if (typeof tag !== 'string' || !TAG.test(tag)) {
    throw new Error('tag must look like sha-0123abc (sha- plus 7 lowercase hex digits)');
  }
  return tag;
}

export const tokenUrl = (name) => `https://ghcr.io/token?scope=repository:${REPO}/${name}:pull`;
export const manifestUrl = (name, tag) => `https://ghcr.io/v2/${REPO}/${name}/manifests/${tag}`;

const TIMEOUT_MS = 10_000;

/** Returns 'ok', 'missing' (404), or 'error: <reason>' for anything else. */
async function checkTag(name, tag, fetchImpl) {
  try {
    const tokenResponse = await fetchImpl(tokenUrl(name), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!tokenResponse.ok) return `error: token request returned ${tokenResponse.status}`;
    const { token } = await tokenResponse.json();
    if (typeof token !== 'string' || token === '') return 'error: no token in response';
    const response = await fetchImpl(manifestUrl(name, tag), {
      method: 'HEAD',
      headers: { Authorization: `Bearer ${token}`, Accept: ACCEPT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 200) return 'ok';
    if (response.status === 404) return 'missing';
    return `error: manifest request returned ${response.status}`;
  } catch (error) {
    return `error: ${error?.name ?? 'Error'}`;
  }
}

/** { missing: names whose tag is absent (404), failed: [{ name, reason }] for checks that errored }. */
export async function findMissingImages({ tag, fetchImpl = fetch }) {
  validateTag(tag);
  const names = imageNames();
  const results = await Promise.all(names.map((name) => checkTag(name, tag, fetchImpl)));
  const missing = names.filter((_, i) => results[i] === 'missing');
  const failed = names
    .map((name, i) => ({ name, reason: results[i].slice('error: '.length) }))
    .filter((_, i) => results[i].startsWith('error: '));
  return { missing, failed };
}

/** `Kind/name` of every Deployment and StatefulSet in rendered YAML. */
export function describeWorkloads(yamlText) {
  return describeKinds(yamlText).filter((id) => /^(Deployment|StatefulSet)\//.test(id));
}

/** `Kind/name` for each document of rendered YAML. */
export function describeKinds(yamlText) {
  return parseAllYaml(yamlText)
    .filter((doc) => doc && doc.kind)
    .map((doc) => `${doc.kind}/${doc.metadata?.name ?? '?'}`);
}

async function main([command, ...args]) {
  if (command === 'check') {
    const tag = validateTag(args[0]);
    const { missing, failed } = await findMissingImages({ tag });
    for (const name of missing) console.error(`deploy: image ${name}:${tag} not found on GHCR`);
    for (const { name, reason } of failed) {
      console.error(`deploy: could not check ${name}: ${reason}`);
    }
    if (missing.length > 0 || failed.length > 0) process.exit(1);
  } else if (command === 'kinds') {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    for (const line of describeKinds(Buffer.concat(chunks).toString('utf8'))) console.log(line);
  } else if (command === 'workloads') {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const workloads = describeWorkloads(Buffer.concat(chunks).toString('utf8'));
    if (workloads.length === 0) throw new Error('rendered YAML has no Deployment or StatefulSet');
    for (const id of workloads) console.log(id);
  } else {
    throw new Error('usage: ghcr.mjs <check <tag> | kinds | workloads>');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`deploy: ${error.message}`);
    process.exit(1);
  });
}
