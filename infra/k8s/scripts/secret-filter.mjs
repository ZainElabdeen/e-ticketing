#!/usr/bin/env node
// Keeps only the allow-listed keys of infra/k8s/.env for the eticket-secrets Secret.
//
//   node infra/k8s/scripts/secret-filter.mjs <env-file> <out-file>
//
// Exit 1 with key names (never values) on stderr when a key is missing, a
// placeholder, or a *_PASSWORD with a character that is unsafe in a URL.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ALLOW_LIST = [
  'POSTGRES_PASSWORD',
  'TICKETS_OWNER_PASSWORD',
  'TICKETS_APP_PASSWORD',
  'PAYMENTS_OWNER_PASSWORD',
  'PAYMENTS_APP_PASSWORD',
  'LEDGER_OWNER_PASSWORD',
  'LEDGER_APP_PASSWORD',
  'PUBLIC_API_KEY_TICKET',
  'PUBLIC_API_KEY_PAYMENT',
  'PUBLIC_API_KEY_LEDGER',
  'INTERNAL_API_KEY_TICKET',
  'INTERNAL_API_KEY_LEDGER',
  'JWT_SECRET',
  'ADMIN_EMAIL',
  'ADMIN_PASSWORD_HASH_B64',
];

const PASSWORD_CHARS = /^[A-Za-z0-9._~-]+$/;
const PLACEHOLDER = /^(replace-with|change-me)/i;

function unquote(value) {
  const v = value.trim();
  if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v.at(-1) === v[0]) return v.slice(1, -1);
  return v;
}

/** Parses env text into a Map; the last assignment of a key wins. */
function parse(envText) {
  const map = new Map();
  for (const raw of envText.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    map.set(line.slice(0, eq).trim(), unquote(line.slice(eq + 1)));
  }
  return map;
}

/** Returns { lines: ['KEY=value', ...] in allow-list order, errors: [messages naming keys only] }. */
export function filterSecrets(envText) {
  const map = parse(envText);
  const lines = [];
  const errors = [];
  for (const key of ALLOW_LIST) {
    const value = map.get(key);
    if (value === undefined || value === '') {
      errors.push(`${key} is missing or empty`);
    } else if (PLACEHOLDER.test(value)) {
      errors.push(`${key} still holds a placeholder`);
    } else if (key.endsWith('_PASSWORD') && !PASSWORD_CHARS.test(value)) {
      errors.push(`${key} has a character outside [A-Za-z0-9._~-]`);
    } else {
      lines.push(`${key}=${value}`);
    }
  }
  return { lines, errors };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [input, output] = process.argv.slice(2);
  if (input === undefined || output === undefined) {
    console.error('usage: secret-filter.mjs <env-file> <out-file>');
    process.exit(2);
  }
  const { lines, errors } = filterSecrets(readFileSync(input, 'utf8'));
  if (errors.length > 0) {
    for (const e of errors) console.error(`secret-filter: ${e}`);
    process.exit(1);
  }
  writeFileSync(output, `${lines.join('\n')}\n`, { mode: 0o600 });
}
