/* global process, console, Buffer */
// Hashes the backoffice admin password (bcrypt cost 12) and prints
// ADMIN_PASSWORD_HASH_B64=<base64>. The password comes from stdin (echo off on a
// TTY) and is never printed. Base64 keeps `$` out of compose files and shells.
//
//   node infra/scripts/admin-hash.mjs
//   node infra/scripts/admin-hash.mjs --append infra/.env --email admin@example.com
//
// With --append, ADMIN_EMAIL and ADMIN_PASSWORD_HASH_B64 are added to the file
// only when missing, and only the key names written are printed.
import { createRequire } from 'node:module';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';

const COST = 12;
const MIN_LENGTH = 12;

const here = dirname(fileURLToPath(import.meta.url));
const requireFromGateway = createRequire(join(here, '..', '..', 'apps', 'gateway', 'package.json'));
const bcrypt = requireFromGateway('bcryptjs');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { append: undefined, email: undefined };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--append' || flag === '--email') {
      const value = argv[++i];
      if (!value) fail(`${flag} needs a value`);
      args[flag.slice(2)] = value;
    } else {
      fail('usage: admin-hash.mjs [--append <file> --email <addr>]');
    }
  }
  if (Boolean(args.append) !== Boolean(args.email)) fail('--append and --email go together');
  return args;
}

async function readPassword() {
  if (process.stdin.isTTY) {
    // Prompt on stderr; the muted output swallows what the user types.
    process.stderr.write('Admin password (min 12 chars): ');
    const muted = new Writable({ write: (_chunk, _enc, done) => done() });
    const rl = createInterface({ input: process.stdin, output: muted, terminal: true });
    const line = await new Promise((resolve) => rl.question('', resolve));
    rl.close();
    process.stderr.write('\n');
    return line;
  }
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0] ?? '';
}

const args = parseArgs(process.argv.slice(2));
const password = await readPassword();
if (password.length < MIN_LENGTH) fail(`Password must be at least ${MIN_LENGTH} characters`);

const value = Buffer.from(bcrypt.hashSync(password, COST)).toString('base64');

if (!args.append) {
  console.log(`ADMIN_PASSWORD_HASH_B64=${value}`);
} else {
  const existing = existsSync(args.append) ? readFileSync(args.append, 'utf8') : '';
  const has = (key) => new RegExp(`^${key}=`, 'm').test(existing);
  const lines = [];
  const written = [];
  if (!has('ADMIN_EMAIL')) {
    lines.push(`ADMIN_EMAIL=${args.email}`);
    written.push('ADMIN_EMAIL');
  }
  if (!has('ADMIN_PASSWORD_HASH_B64')) {
    lines.push(`ADMIN_PASSWORD_HASH_B64=${value}`);
    written.push('ADMIN_PASSWORD_HASH_B64');
  }
  if (lines.length > 0) {
    const lead = existing === '' || existing.endsWith('\n') ? '' : '\n';
    appendFileSync(args.append, `${lead}${lines.join('\n')}\n`);
  }
  console.log(
    written.length > 0 ? `Wrote: ${written.join(', ')}` : 'Nothing to write: keys already present',
  );
}
