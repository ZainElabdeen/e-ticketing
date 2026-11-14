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

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// bcrypt ignores everything past byte 72, so a longer password would be truncated silently.
const MAX_BYTES = 72;

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
  // A newline in the email would let it inject extra lines into the env file.
  if (args.email !== undefined && (/[\r\n]/.test(args.email) || !EMAIL.test(args.email))) {
    fail('--email must be a plain email address', 2);
  }
  return args;
}

async function readPassword() {
  if (process.stdin.isTTY) {
    // Prompt on stderr; the muted output swallows what the user types.
    process.stderr.write('Admin password (min 12 chars): ');
    const muted = new Writable({ write: (_chunk, _enc, done) => done() });
    const rl = createInterface({ input: process.stdin, output: muted, terminal: true });
    // Ctrl-D closes the interface and Ctrl-C raises SIGINT; neither may print a hash.
    const line = await new Promise((resolve) => {
      rl.on('close', () => resolve(undefined));
      rl.on('SIGINT', () => {
        process.stderr.write('\n');
        process.exit(130);
      });
      rl.question('', resolve);
    });
    rl.close();
    process.stderr.write('\n');
    if (line === undefined) fail('No password given');
    return line;
  }
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0] ?? '';
}

const args = parseArgs(process.argv.slice(2));
const password = await readPassword();
if (Buffer.byteLength(password) > MAX_BYTES) {
  fail(`Password must be at most ${MAX_BYTES} bytes (bcrypt ignores anything longer)`);
}
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
