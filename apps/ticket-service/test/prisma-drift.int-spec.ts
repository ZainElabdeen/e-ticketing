import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { applyMigrations, startTestDatabase, type TestDatabase } from '@eticket/testing';

const APP_DIR = path.resolve(__dirname, '..');

// Prisma does not model CHECK constraints, so they are out of scope here;
// schema.int-spec.ts covers them.
describe('prisma schema vs migrated database', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
    applyMigrations(db, 'ticket-service');
  });

  afterAll(async () => {
    await db.stop();
  });

  it('has no drift between prisma/schema.prisma and the SQL migration', () => {
    const result = spawnSync(
      'pnpm',
      [
        'exec',
        'prisma',
        'migrate',
        'diff',
        '--from-config-datasource',
        '--to-schema',
        'prisma/schema.prisma',
        '--exit-code',
      ],
      {
        cwd: APP_DIR,
        env: { ...process.env, MIGRATION_DATABASE_URL: db.urlFor('tickets_owner') },
        encoding: 'utf8',
      },
    );
    // Exit code 2 means a diff exists; the output names it.
    expect({ status: result.status, out: result.stdout + result.stderr }).toMatchObject({
      status: 0,
    });
  });
});
