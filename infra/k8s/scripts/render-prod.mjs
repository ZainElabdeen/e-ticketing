#!/usr/bin/env node
// Fills the placeholders of the prod overlay and the Traefik HelmChartConfig.
//
//   node infra/k8s/scripts/render-prod.mjs --host <dns> --tag <sha-xxxxxxx> --out <dir>
//        [--acme-email <addr> --traefik-out <file>]
//
// --out receives kustomization.yaml and must sit two levels below infra/k8s
// (overlays/prod, or .rendered/<name>) so its `../../base` resolves; the
// generated files are git-ignored. Then: scripts/render.sh <dir>.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  if (values.out === undefined) throw new Error('--out <dir> is required');
  const kustomization = renderProd({ host: values.host, tag: values.tag });
  mkdirSync(values.out, { recursive: true });
  writeFileSync(join(values.out, 'kustomization.yaml'), kustomization);
  if (values['traefik-out'] !== undefined) {
    writeFileSync(
      values['traefik-out'],
      renderHelmChartConfig({ acmeEmail: values['acme-email'] }),
    );
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
