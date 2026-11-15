// One-command local setup: generates every secret in infra/.env and the
// backoffice admin login. Existing real values are never overwritten.
//
//   node infra/scripts/setup-local.mjs [--email <addr>] [--password-stdin]
//                                      [--reset-admin] [--env <path>] [--no-ports]
//                                      [--login-file <path>]
//
// Needs `pnpm install` first (bcryptjs is loaded from the gateway package).
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generatePassword, hashAdminPassword, MAX_BYTES } from './lib/admin-hash-lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE_PATH = join(here, '..', '.env.example');
const DEFAULT_ENV_PATH = join(here, '..', '.env');
const DEFAULT_LOGIN_FILE = join(here, '..', '.admin-login.txt');
const MIN_BYTES = 8;
// Characters an env file and compose pass through unchanged.
const SAFE_PASSWORD = /^[A-Za-z0-9._~!@%^&*+=-]+$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_EMAIL = 'admin@eticket.local';
const SECRET_KEY = /(_PASSWORD|_API_KEY_[A-Z]+|^JWT_SECRET)$/;
const PORTS = [
  { key: 'GATEWAY_HOST_PORT', port: 3000, label: 'gateway' },
  { key: 'POSTGRES_HOST_PORT', port: 5432, label: 'postgres' },
  { key: 'WEB_HOST_PORT', port: 8080, label: 'web' },
];

// KEY=value, optionally prefixed with `export` and padded with whitespace.
const ENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

export const USAGE =
  'usage: setup-local.mjs [--email <addr>] [--password-stdin] [--reset-admin] [--env <path>] [--no-ports] [--login-file <path>]\n  (--password-stdin with empty input is rejected; it does not generate a password)';

export function isPlaceholder(value) {
  return value === '' || /^(replace-with|change-me)/i.test(value);
}

export function parseEnv(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = ENV_LINE.exec(line);
    if (m) map.set(m[1], m[2].trim());
  }
  return map;
}

/** Non-comment, non-blank lines parseEnv ignores, as 1-based line numbers and text. */
export function unmatchedLines(text) {
  const out = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (line.trim() === '' || /^\s*#/.test(line)) return;
    if (!ENV_LINE.test(line)) out.push({ number: i + 1, text: line });
  });
  return out;
}

/** Writes via <path>.tmp (mode 600 from the start) and renames, so no world-readable window. */
export function writeAtomic(path, content) {
  const tmp = `${path}.tmp`;
  rmSync(tmp, { force: true });
  writeFileSync(tmp, content, { flag: 'wx', mode: 0o600 });
  renameSync(tmp, path);
}

/** Re-renders the example with `values`, keeping its comments and key order. */
export function renderEnv(exampleText, values, keptLines = []) {
  const seen = new Set();
  const lines = exampleText.split('\n').map((line) => {
    const m = /^(# ?)?([A-Z][A-Z0-9_]*)=/.exec(line);
    if (!m) return line;
    const key = m[2];
    seen.add(key);
    if (!values.has(key)) return line;
    // A commented-out optional key becomes a real line only once a value is set.
    if (m[1] && values.get(key) === '') return line;
    return `${key}=${values.get(key)}`;
  });
  let out = lines.join('\n');
  const extras = [...values].filter(([key]) => !seen.has(key));
  if (extras.length > 0) {
    out += `${out.endsWith('\n') ? '' : '\n'}${extras.map(([k, v]) => `${k}=${v}`).join('\n')}\n`;
  }
  if (keptLines.length > 0) {
    out += `${out.endsWith('\n') ? '' : '\n'}\n# Lines kept as written\n${keptLines.join('\n')}\n`;
  }
  return out;
}

const hex = (bytes) => randomBytes(bytes).toString('hex');

/** Fills placeholder secret keys. Returns the new map and only the key names it generated. */
export function fillSecrets(values, rand = hex) {
  const out = new Map(values);
  const generated = [];
  for (const [key, value] of values) {
    if (!SECRET_KEY.test(key) || !isPlaceholder(value)) continue;
    out.set(key, rand(key === 'JWT_SECRET' ? 48 : 32));
    generated.push(key);
  }
  return { values: out, generated };
}

function isFree(port) {
  return new Promise((done) => {
    const server = createServer();
    server.once('error', () => done(false));
    server.listen(port, '127.0.0.1', () => server.close(() => done(true)));
  });
}

/** The default port when free on 127.0.0.1, else the first free port from default+100 upward. */
export async function pickPort(defaultPort) {
  if (await isFree(defaultPort)) return defaultPort;
  for (let port = defaultPort + 100; port <= 65535; port += 1) {
    if (await isFree(port)) return port;
  }
  throw new Error(`No free port found above ${defaultPort}`);
}

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function parseArgs(argv) {
  const args = {
    email: undefined,
    passwordStdin: false,
    resetAdmin: false,
    env: DEFAULT_ENV_PATH,
    ports: true,
    loginFile: DEFAULT_LOGIN_FILE,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--email' || flag === '--env' || flag === '--login-file') {
      const value = argv[++i];
      if (!value) fail(`${flag} needs a value\n${USAGE}`, 2);
      args[flag === '--login-file' ? 'loginFile' : flag.slice(2)] = value;
    } else if (flag === '--password-stdin') args.passwordStdin = true;
    else if (flag === '--reset-admin') args.resetAdmin = true;
    else if (flag === '--no-ports') args.ports = false;
    else fail(USAGE, 2);
  }
  args.env = resolve(args.env);
  args.loginFile = resolve(args.loginFile);
  // A newline in the email would let it inject extra lines into the env file.
  if (args.email !== undefined && !EMAIL.test(args.email))
    fail('--email must be a plain email address', 2);
  return args;
}

async function promptHidden(question) {
  process.stderr.write(question);
  const muted = new Writable({ write: (_chunk, _enc, done) => done() });
  const rl = createInterface({ input: process.stdin, output: muted, terminal: true });
  const line = await new Promise((done) => {
    rl.on('close', () => done(undefined));
    rl.on('SIGINT', () => {
      process.stderr.write('\n');
      process.exit(130);
    });
    rl.question('', done);
  });
  rl.close();
  process.stderr.write('\n');
  return line ?? '';
}

async function readStdinLine() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0] ?? '';
}

async function chooseAdminPassword(args) {
  let password;
  let generated = false;
  if (args.passwordStdin) password = await readStdinLine();
  else if (process.stdin.isTTY) {
    password = await promptHidden('Admin password (leave empty to generate): ');
  } else password = '';
  if (password === '' && !args.passwordStdin) {
    password = generatePassword();
    generated = true;
  }
  if (!generated && password !== '' && !SAFE_PASSWORD.test(password)) {
    fail(
      'Admin password may only use these characters: A-Za-z0-9 . _ ~ ! @ % ^ & * + = - (no spaces, #, $, quotes, backslash or backtick)',
      2,
    );
  }
  const bytes = Buffer.byteLength(password);
  if (bytes < MIN_BYTES || bytes > MAX_BYTES) {
    fail(`Admin password must be ${MIN_BYTES}-${MAX_BYTES} bytes`, 2);
  }
  return { password, generated };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const exampleText = readFileSync(EXAMPLE_PATH, 'utf8');
  const envExisted = existsSync(args.env);

  let values = parseEnv(exampleText);
  let kept = [];
  if (envExisted) {
    const existingText = readFileSync(args.env, 'utf8');
    for (const [k, v] of parseEnv(existingText)) values.set(k, v);
    kept = unmatchedLines(existingText);
  }

  const filled = fillSecrets(values);
  values = filled.values;
  const generated = filled.generated;

  const existingEmail = values.get('ADMIN_EMAIL') ?? '';
  const adminMissing =
    isPlaceholder(existingEmail) || isPlaceholder(values.get('ADMIN_PASSWORD_HASH_B64') ?? '');
  const adminNeeded = args.resetAdmin || adminMissing;
  const warnings = kept.map(
    ({ number }) => `Warning: line ${number} of the env file is not KEY=value; kept as written`,
  );
  if (!adminNeeded && isPlaceholder(values.get('ADMIN_PASSWORD_DEV') ?? '')) {
    warnings.push(
      'ADMIN_PASSWORD_DEV is not set; smoke and contract tests need it. Run with --reset-admin to set a new admin password.',
    );
  }

  let adminPassword;
  let passwordGenerated = false;
  if (adminNeeded) {
    const chosen = await chooseAdminPassword(args);
    adminPassword = chosen.password;
    passwordGenerated = chosen.generated;
    values.set(
      'ADMIN_EMAIL',
      args.email ?? (isPlaceholder(existingEmail) ? DEFAULT_EMAIL : existingEmail),
    );
    values.set('ADMIN_PASSWORD_HASH_B64', await hashAdminPassword(adminPassword));
    values.set('ADMIN_PASSWORD_DEV', adminPassword);
  }

  // Only a new env file gets ports picked: on a later run the stack's own containers hold the defaults.
  const portNotes = [];
  if (args.ports && !envExisted) {
    for (const { key, port, label } of PORTS) {
      if (values.get(key)) continue;
      const picked = await pickPort(port);
      values.set(key, String(picked));
      if (picked !== port) portNotes.push(`Port ${port} is busy; ${label} will use ${picked}`);
    }
  }

  writeAtomic(
    args.env,
    renderEnv(
      exampleText,
      values,
      kept.map((k) => k.text),
    ),
  );

  console.log(
    generated.length > 0 ? `Generated: ${generated.join(', ')}` : 'No secrets to generate',
  );
  if (generated.some((key) => key.endsWith('_PASSWORD'))) {
    console.log(
      'If you ran the stack before with other passwords, reset the database volume first: docker compose -f infra/docker-compose.yml down -v (this deletes all data).',
    );
  }
  for (const note of portNotes) console.log(note);
  for (const warning of warnings) console.log(warning);

  if (adminPassword !== undefined) {
    const webPort = values.get('WEB_HOST_PORT') || '8080';
    const shown = passwordGenerated ? adminPassword : '(the one you entered)';
    const login = [
      'Backoffice login (shown once — store it now):',
      `  URL:      http://127.0.0.1:${webPort}/backoffice`,
      `  Email:    ${values.get('ADMIN_EMAIL')}`,
      `  Password: ${shown}`,
    ].join('\n');
    if (process.stdout.isTTY || !passwordGenerated) {
      // A stale file would hold an older password.
      rmSync(args.loginFile, { force: true });
      console.log(login);
    } else {
      writeAtomic(args.loginFile, `${login}\n`);
      console.log(
        `Backoffice login written to ${args.loginFile} (mode 600, git-ignored); delete it once stored.`,
      );
    }
  } else {
    console.log('Admin login unchanged (use --reset-admin for a new password)');
  }

  if (adminPassword !== undefined && envExisted) {
    console.log(
      'Restart: docker compose -f infra/docker-compose.yml up -d gateway && docker compose -f infra/docker-compose.yml restart web',
    );
  }
  console.log('Next: docker compose -f infra/docker-compose.yml up -d --build --wait');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
}
