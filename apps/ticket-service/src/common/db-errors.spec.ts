import { isUniqueViolation } from './db-errors';

describe('isUniqueViolation', () => {
  it('matches a Postgres 23505 naming the constraint', () =>
    expect(isUniqueViolation({ code: '23505', constraint: 'c1' }, 'c1')).toBe(true));

  it('matches a Prisma P2002 that names the constraint in its message or cause', () => {
    expect(isUniqueViolation({ code: 'P2002', message: 'violates "c1"' }, 'c1')).toBe(true);
    expect(isUniqueViolation({ cause: { code: '23505', constraint: 'c1' } }, 'c1')).toBe(true);
  });

  it('matches constraint names exactly, not by substring', () => {
    expect(isUniqueViolation({ code: '23505', constraint: 'foo_key2' }, 'foo_key')).toBe(false);
    expect(isUniqueViolation({ code: 'P2002', message: 'violates "foo_key2"' }, 'foo_key')).toBe(
      false,
    );
    expect(isUniqueViolation({ code: 'P2002', meta: { target: ['foo_key2'] } }, 'foo_key')).toBe(
      false,
    );
    expect(isUniqueViolation({ code: 'P2002', meta: { target: 'foo_key' } }, 'foo_key')).toBe(true);
  });

  it('matches a raw-query P2010 wrapping a 23505, as Prisma reports it', () => {
    const err = {
      code: 'P2010',
      message:
        'Raw query failed. Code: `23505`. Message: `duplicate key value violates unique constraint "c1"`',
      meta: {
        driverAdapterError: { cause: { originalCode: '23505', constraint: { index: 'c1' } } },
      },
    };
    expect(isUniqueViolation(err, 'c1')).toBe(true);
    expect(isUniqueViolation(err, 'c')).toBe(false);
    expect(isUniqueViolation({ code: 'P2010', message: 'Code: `42P01`' }, 'c1')).toBe(false);
  });

  it('rejects other constraints, other codes and non-errors', () => {
    expect(isUniqueViolation({ code: '23505', constraint: 'other' }, 'c1')).toBe(false);
    expect(isUniqueViolation({ code: '23503', constraint: 'c1' }, 'c1')).toBe(false);
    expect(isUniqueViolation(undefined, 'c1')).toBe(false);
  });
});
