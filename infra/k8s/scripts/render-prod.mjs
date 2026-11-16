#!/usr/bin/env node
// Fills the placeholders of the prod overlay and the Traefik HelmChartConfig.
//
//   node infra/k8s/scripts/render-prod.mjs --target <prod|validate> --host <dns> --tag <sha-xxxxxxx>
//   node infra/k8s/scripts/render-prod.mjs --traefik --acme-email <addr>
//
// No path is taken from the command line. --target picks one of two fixed
// directories (prod -> overlays/prod, validate -> .rendered/validate)
// that receive kustomization.yaml; --traefik writes .rendered/traefik-config.yaml and
// prints its path. The generated files are git-ignored. Then: scripts/render.sh <dir>.
import { lstatSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { isEmail } from '../../scripts/lib/strings.mjs';

const k8sDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const kustomizationTemplate = join(k8sDir, 'overlays/prod/kustomization.template.yaml');
const helmChartConfig = join(k8sDir, 'traefik/helmchartconfig.yaml');

const TAG = /^sha-[0-9a-f]{7}$/;
const EMAIL_CHARS = /^[A-Za-z0-9._%+@-]+$/;
const LABEL_CHARS = /^[a-z0-9-]+$/;

/** A lowercase DNS name with at least two labels (what an Ingress host and ACME accept). */
export function isDnsName(value) {
  if (typeof value !== 'string' || value.length > 253) return false;
  const labels = value.split('.');
  return (
    labels.length >= 2 &&
    labels.every(
      (label) =>
        label.length >= 1 &&
        label.length <= 63 &&
        LABEL_CHARS.test(label) &&
        !label.startsWith('-') &&
        !label.endsWith('-'),
    )
  );
}

function lstatOrNull(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/** Writes a fresh file: never follows a link planted at the path (`wx` fails on any existing entry). */
function writeFresh(file, text) {
  const existing = lstatOrNull(file);
  if (existing?.isSymbolicLink()) throw new Error(`${file} is a symbolic link`);
  if (existing?.isFile()) unlinkSync(file);
  writeFileSync(file, text, { flag: 'wx' });
}

function fill(template, values) {
  return template.replace(/\$\{([A-Z_]+)\}/g, (whole, name) => values[name] ?? whole);
}

/** Returns the prod kustomization text with the host and image tag filled in. */
export function renderProd({ host, tag }) {
  if (!isDnsName(host))
    throw new Error('HOST must be a lowercase DNS name such as demo.example.org');
  if (typeof tag !== 'string' || !TAG.test(tag))
    throw new Error('TAG must look like sha-0123abc (sha- plus 7 hex digits)');
  return fill(readFileSync(kustomizationTemplate, 'utf8'), { HOST: host, TAG: tag });
}

/** Returns the Traefik HelmChartConfig text with the ACME email filled in. */
export function renderHelmChartConfig({ acmeEmail }) {
  if (typeof acmeEmail !== 'string' || !isEmail(acmeEmail) || !EMAIL_CHARS.test(acmeEmail)) {
    throw new Error('ACME_EMAIL must be a valid email address');
  }
  return fill(readFileSync(helmChartConfig, 'utf8'), { ACME_EMAIL: acmeEmail });
}

/** Fixed output directory under `root` (the infra/k8s directory) for a literal target name. */
function overlayDir(root, target) {
  switch (target) {
    case 'prod':
      return join(root, 'overlays', 'prod');
    case 'validate':
      return join(root, '.rendered', 'validate');
    default:
      return null;
  }
}

/** Writes <root>/<fixed dir for target>/kustomization.yaml. Returns the file, or null for an unknown target. */
export function writeOverlay(root, target, { host, tag }) {
  const dir = overlayDir(root, target);
  if (dir === null) return null;
  const text = renderProd({ host, tag });
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'kustomization.yaml');
  writeFresh(file, text);
  return file;
}

/** Writes <root>/.rendered/traefik-config.yaml and returns its path. */
export function writeTraefikConfig(root, { acmeEmail }) {
  const text = renderHelmChartConfig({ acmeEmail });
  const dir = join(root, '.rendered');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'traefik-config.yaml');
  writeFresh(file, text);
  return file;
}

function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      target: { type: 'string' },
      host: { type: 'string' },
      tag: { type: 'string' },
      traefik: { type: 'boolean' },
      'acme-email': { type: 'string' },
    },
  });
  if (values.traefik) {
    if (values.target !== undefined || values.host !== undefined || values.tag !== undefined) {
      throw new Error('--traefik cannot be combined with --target, --host or --tag');
    }
    console.log(writeTraefikConfig(k8sDir, { acmeEmail: values['acme-email'] }));
    return;
  }
  if (values['acme-email'] !== undefined) throw new Error('--acme-email needs --traefik');
  if (writeOverlay(k8sDir, values.target, { host: values.host, tag: values.tag }) === null) {
    console.error('render-prod: --target must be one of prod, validate');
    process.exit(2);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`render-prod: ${error.message}`);
    process.exit(1);
  }
}
