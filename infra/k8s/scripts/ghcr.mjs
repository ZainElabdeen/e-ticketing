#!/usr/bin/env node
// Pure parts of deploy.sh: tag validation, image list, GHCR URLs, tag-exists check.
//
//   node ghcr.mjs check <sha-tag>          exit 1 naming each image missing the tag
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

async function hasTag(name, tag, fetchImpl) {
  const tokenResponse = await fetchImpl(tokenUrl(name));
  if (!tokenResponse.ok) return false;
  const { token } = await tokenResponse.json();
  if (typeof token !== 'string' || token === '') return false;
  const response = await fetchImpl(manifestUrl(name, tag), {
    method: 'HEAD',
    headers: { Authorization: `Bearer ${token}`, Accept: ACCEPT },
  });
  return response.status === 200;
}

/** Names of the images that do not have `tag` on GHCR. */
export async function findMissingImages({ tag, fetchImpl = fetch }) {
  validateTag(tag);
  const names = imageNames();
  const results = await Promise.all(
    names.map(async (name) => {
      try {
        return await hasTag(name, tag, fetchImpl);
      } catch {
        return false;
      }
    }),
  );
  return names.filter((_, i) => !results[i]);
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
    const missing = await findMissingImages({ tag });
    if (missing.length > 0) {
      for (const name of missing) console.error(`deploy: image ${name}:${tag} not found on GHCR`);
      process.exit(1);
    }
  } else if (command === 'kinds') {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    for (const line of describeKinds(Buffer.concat(chunks).toString('utf8'))) console.log(line);
  } else {
    throw new Error('usage: ghcr.mjs <check <tag> | kinds>');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`deploy: ${error.message}`);
    process.exit(1);
  });
}
