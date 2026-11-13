import type { Client } from 'pg';
import { startTestDatabase, TEST_PASSWORD, type TestDatabase } from '../src';

const SCHEMAS = ['tickets', 'payments', 'ledger'] as const;
const ROLES = [
  'tickets_owner',
  'tickets_app',
  'payments_owner',
  'payments_app',
  'ledger_owner',
  'ledger_app',
] as const;

async function withClient<T>(
  db: TestDatabase,
  role: 'postgres' | (typeof ROLES)[number],
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = await db.connectAs(role);
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

describe('postgres bootstrap', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  });

  afterAll(async () => {
    await db.stop();
  });

  it('creates three schemas owned by their owner roles', async () => {
    const rows = await withClient(db, 'postgres', async (client) => {
      const result = await client.query<{ nspname: string; owner: string }>(
        `SELECT nspname, pg_get_userbyid(nspowner) AS owner
           FROM pg_namespace
          WHERE nspname IN ('tickets','payments','ledger')
          ORDER BY 1`,
      );
      return result.rows;
    });

    expect(rows).toEqual([
      { nspname: 'ledger', owner: 'ledger_owner' },
      { nspname: 'payments', owner: 'payments_owner' },
      { nspname: 'tickets', owner: 'tickets_owner' },
    ]);
  });

  it('lets each role log in', async () => {
    expect(TEST_PASSWORD).toBe('test-password');

    for (const role of ROLES) {
      const currentUser = await withClient(db, role, async (client) => {
        const result = await client.query<{ current_user: string }>('SELECT current_user');
        return result.rows[0]?.current_user;
      });
      expect(currentUser).toBe(role);
    }
  });

  it('denies app roles DDL in their own schema', async () => {
    await withClient(db, 'tickets_app', async (client) => {
      await expect(client.query('CREATE TABLE tickets.x (id int)')).rejects.toMatchObject({
        code: '42501',
      });
    });
  });

  it('denies app roles access to other schemas', async () => {
    const pairs = ROLES.filter((role) => role.endsWith('_app')).flatMap((role) =>
      SCHEMAS.filter((schema) => `${schema}_app` !== role).map((schema) => ({ role, schema })),
    );

    const grants = await withClient(db, 'postgres', async (client) => {
      const result = await client.query<{ role: string; schema: string; usage: boolean }>(
        `SELECT r.role, s.schema, has_schema_privilege(r.role, s.schema, 'USAGE') AS usage
           FROM unnest($1::text[]) AS r(role)
          CROSS JOIN unnest($2::text[]) AS s(schema)
          WHERE r.role LIKE '%_app' AND r.role <> s.schema || '_app'`,
        [ROLES, SCHEMAS],
      );
      return result.rows;
    });

    expect(grants).toHaveLength(pairs.length);
    for (const grant of grants) {
      expect({ role: grant.role, schema: grant.schema, usage: grant.usage }).toEqual({
        role: grant.role,
        schema: grant.schema,
        usage: false,
      });
    }
  });

  it('grants app roles DML on tables the owner creates later', async () => {
    await withClient(db, 'tickets_owner', async (client) => {
      await client.query('CREATE TABLE tickets.probe (id int)');
    });

    try {
      await withClient(db, 'tickets_app', async (client) => {
        await client.query('INSERT INTO tickets.probe VALUES (1)');
        const result = await client.query<{ id: number }>('SELECT id FROM tickets.probe');
        expect(result.rows).toEqual([{ id: 1 }]);
      });
    } finally {
      await withClient(db, 'tickets_owner', async (client) => {
        await client.query('DROP TABLE tickets.probe');
      });
    }
  });
});
