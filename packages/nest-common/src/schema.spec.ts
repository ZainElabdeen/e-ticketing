import { schemaOf } from './schema';

describe('schemaOf', () => {
  it('reads the schema query parameter', () =>
    expect(schemaOf('postgresql://u:p@h:5432/db?schema=tickets', 'x')).toBe('tickets'));

  it('falls back when absent or unparsable', () => {
    expect(schemaOf('postgresql://x/db', 'payments')).toBe('payments');
    expect(schemaOf('not a url', 'payments')).toBe('payments');
  });
});
