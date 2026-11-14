import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import { decodeAdminHash } from './admin-hash';

const SCRIPT = join(__dirname, '..', '..', '..', '..', 'infra', 'scripts', 'admin-hash.mjs');
const PASSWORD = 'a-long-test-password';

function run(args: string[], input: string) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { input, encoding: 'utf8' });
}

describe('infra/scripts/admin-hash.mjs', () => {
  it('prints a base64 hash that decodes and matches the piped password', () => {
    const r = run([], `${PASSWORD}\n`);
    expect(r.status).toBe(0);
    const match = /^ADMIN_PASSWORD_HASH_B64=(\S+)$/m.exec(r.stdout);
    expect(match).not.toBeNull();
    const hash = decodeAdminHash(match![1]!);
    expect(bcrypt.compareSync(PASSWORD, hash)).toBe(true);
    expect(r.stdout + r.stderr).not.toContain(PASSWORD);
  });

  it('rejects a password shorter than 12 characters', () => {
    const r = run([], 'short\n');
    expect(r.status).not.toBe(0);
    expect(r.stdout).not.toContain('ADMIN_PASSWORD_HASH_B64=');
  });

  it('appends only the missing keys and prints key names only', () => {
    const dir = mkdtempSync(join(tmpdir(), 'admin-hash-'));
    const file = join(dir, '.env');
    writeFileSync(file, 'ADMIN_EMAIL=existing@example.com\n');
    const r = run(['--append', file, '--email', 'new@example.com'], `${PASSWORD}\n`);
    expect(r.status).toBe(0);
    const content = readFileSync(file, 'utf8');
    expect(content).toContain('ADMIN_EMAIL=existing@example.com');
    expect(content).not.toContain('new@example.com');
    expect(content).toMatch(/^ADMIN_PASSWORD_HASH_B64=\S+$/m);
    expect(r.stdout).toContain('ADMIN_PASSWORD_HASH_B64');
    expect(r.stdout).not.toMatch(/ADMIN_PASSWORD_HASH_B64=\S/);
    expect(r.stdout + r.stderr).not.toContain(PASSWORD);
    // A second run changes nothing.
    const again = run(['--append', file, '--email', 'new@example.com'], `${PASSWORD}\n`);
    expect(again.status).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe(content);
  });

  it.each([
    ['a newline', 'a@example.com\nINJECT=1'],
    ['a carriage return', 'a@example.com\rINJECT=1'],
    ['a non-email', 'not-an-email'],
  ])('rejects an --email with %s with exit 2 and writes nothing', (_n, email) => {
    const dir = mkdtempSync(join(tmpdir(), 'admin-hash-'));
    const file = join(dir, '.env');
    const r = run(['--append', file, '--email', email], `${PASSWORD}\n`);
    expect(r.status).toBe(2);
    expect(r.stdout).not.toContain('ADMIN_PASSWORD_HASH_B64=');
    expect(existsSync(file)).toBe(false);
  });

  it('rejects a password longer than 72 bytes', () => {
    const r = run([], `${'é'.repeat(37)}\n`);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/72 bytes/);
    expect(r.stdout).not.toContain('ADMIN_PASSWORD_HASH_B64=');
  });

  it('exits non-zero without a hash when stdin is empty', () => {
    const r = run([], '');
    expect(r.status).not.toBe(0);
    expect(r.stdout).not.toContain('ADMIN_PASSWORD_HASH_B64=');
  });
});
