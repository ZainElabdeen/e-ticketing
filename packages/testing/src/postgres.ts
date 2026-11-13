import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';

export type Schema = 'tickets' | 'payments' | 'ledger';
export type AppName = 'ticket-service' | 'payment-service' | 'ledger-service';
export type Role = `${Schema}_owner` | `${Schema}_app`;

export const SCHEMA_OF: Record<AppName, Schema> = {
  'ticket-service': 'tickets',
  'payment-service': 'payments',
  'ledger-service': 'ledger',
};

/** Throwaway password shared by every role in tests; never used outside them. */
export const TEST_PASSWORD = 'test-password';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const INIT_SCRIPT = path.join(REPO_ROOT, 'infra/postgres/init/00-roles.sh');
const DATABASE = 'eticketing';
const POSTGRES_PORT = 5432;

export interface TestDatabase {
  /** `postgresql://<role>:<pw>@<host>:<port>/eticketing`; owner/app roles add `?schema=<schema>`. */
  urlFor(role: Role | 'postgres'): string;
  /** Connected client; the caller ends it. */
  connectAs(role: Role | 'postgres'): Promise<Client>;
  stop(): Promise<void>;
}

export async function startTestDatabase(): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer('postgres:18-alpine')
    .withDatabase(DATABASE)
    .withUsername('postgres')
    .withPassword(TEST_PASSWORD)
    .withEnvironment({
      TICKETS_OWNER_PASSWORD: TEST_PASSWORD,
      TICKETS_APP_PASSWORD: TEST_PASSWORD,
      PAYMENTS_OWNER_PASSWORD: TEST_PASSWORD,
      PAYMENTS_APP_PASSWORD: TEST_PASSWORD,
      LEDGER_OWNER_PASSWORD: TEST_PASSWORD,
      LEDGER_APP_PASSWORD: TEST_PASSWORD,
    })
    .withCopyFilesToContainer([
      {
        source: INIT_SCRIPT,
        target: '/docker-entrypoint-initdb.d/00-roles.sh',
        mode: 0o755,
      },
    ])
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(POSTGRES_PORT);

  const urlFor = (role: Role | 'postgres'): string => {
    if (role === 'postgres') {
      return `postgresql://postgres:${TEST_PASSWORD}@${host}:${port}/${DATABASE}`;
    }
    const schema = role.slice(0, role.lastIndexOf('_')) as Schema;
    return `postgresql://${role}:${TEST_PASSWORD}@${host}:${port}/${DATABASE}?schema=${schema}`;
  };

  return {
    urlFor,
    async connectAs(role) {
      const client = new Client({ connectionString: urlFor(role) });
      await client.connect();
      return client;
    },
    async stop() {
      await container.stop();
    },
  };
}

/**
 * Applies an app's hand-written SQL migrations as its owner role, the same way
 * a migrate container or K8s Job does (ADR-0015: `migrate deploy` only).
 */
export function applyMigrations(db: TestDatabase, app: AppName): void {
  const schema = SCHEMA_OF[app];
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: path.join(REPO_ROOT, 'apps', app),
    env: { ...process.env, MIGRATION_DATABASE_URL: db.urlFor(`${schema}_owner`) },
    stdio: 'pipe',
  });
}
