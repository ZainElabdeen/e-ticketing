#!/usr/bin/env node
// Fills the placeholders of the prod overlay and the Traefik HelmChartConfig.
//
//   node infra/k8s/scripts/render-prod.mjs --host <dns> --tag <sha-xxxxxxx> --out <dir>
//        [--acme-email <addr> --traefik-out <file.yaml>]
//
// --out receives kustomization.yaml and must sit two levels below infra/k8s
// (overlays/prod, or .rendered/<name>) so its `../../base` resolves; the
// generated files are git-ignored. Then: scripts/render.sh <dir>.
// --out may be left out when only --traefik-out is wanted. --traefik-out must be a
// .yaml file inside the system temp dir or infra/k8s/.rendered/. Symlinks that leave
// those places and `..` escapes are rejected.
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
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

/** realpath of a path that may not exist yet: the nearest existing ancestor is resolved. */
function realPathLoose(path) {
  const rest = [];
  let current = resolve(path);
  while (!existsSync(current)) {
    rest.unshift(basename(current));
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return join(realpathSync(current), ...rest);
}

/** Validates --out: exactly two levels below infra/k8s. Returns the real path. */
export function checkOutDir(out) {
  const real = realPathLoose(out);
  if (dirname(dirname(real)) !== realpathSync(k8sDir)) {
    throw new Error(
      '--out must be infra/k8s/overlays/prod or infra/k8s/.rendered/<name> (two levels below infra/k8s)',
    );
  }
  return real;
}

/** Validates --traefik-out: a .yaml file in the temp dir or infra/k8s/.rendered/. Returns the real path. */
export function checkTraefikOut(file) {
  const real = realPathLoose(file);
  const roots = [realpathSync(tmpdir()), realPathLoose(join(k8sDir, '.rendered'))];
  const inside = roots.some((root) => real.startsWith(root + sep));
  if (!inside || !real.endsWith('.yaml')) {
    throw new Error(
      '--traefik-out must be a .yaml file inside the system temp dir or infra/k8s/.rendered/',
    );
  }
  return real;
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

function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      host: { type: 'string' },
      tag: { type: 'string' },
      out: { type: 'string' },
      'acme-email': { type: 'string' },
      'traefik-out': { type: 'string' },
    },
  });
  if (values.out === undefined && values['traefik-out'] === undefined) {
    throw new Error('--out <dir> is required');
  }
  const outDir = values.out === undefined ? undefined : checkOutDir(values.out);
  const traefikOut =
    values['traefik-out'] === undefined ? undefined : checkTraefikOut(values['traefik-out']);
  const kustomization = renderProd({ host: values.host, tag: values.tag });
  if (outDir !== undefined) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'kustomization.yaml'), kustomization);
  }
  if (traefikOut !== undefined) {
    writeFileSync(traefikOut, renderHelmChartConfig({ acmeEmail: values['acme-email'] }));
  } else if (values['acme-email'] !== undefined) {
    throw new Error('--acme-email needs --traefik-out <file>');
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
