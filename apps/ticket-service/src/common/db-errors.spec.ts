import { isUniqueViolation } from './db-errors';

describe('isUniqueViolation', () => {
  it('matches a Postgres 23505 naming the constraint', () =>
    expect(isUniqueViolation({ code: '23505', constraint: 'c1' }, 'c1')).toBe(true));

  it('matches a Prisma P2002 that names the constraint in its message or cause', () => {
    expect(isUniqueViolation({ code: 'P2002', message: 'violates "c1"' }, 'c1')).toBe(true);
    expect(isUniqueViolation({ cause: { code: '23505', constraint: 'c1' } }, 'c1')).toBe(true);
  });

  it('rejects other constraints, other codes and non-errors', () => {
    expect(isUniqueViolation({ code: '23505', constraint: 'other' }, 'c1')).toBe(false);
    expect(isUniqueViolation({ code: '23503', constraint: 'c1' }, 'c1')).toBe(false);
    expect(isUniqueViolation(undefined, 'c1')).toBe(false);
  });
});
