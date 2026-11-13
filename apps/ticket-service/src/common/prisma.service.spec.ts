import { schemaOf } from './prisma.service';

describe('schemaOf', () => {
  it('reads the schema query parameter', () =>
    expect(schemaOf('postgresql://u:p@h:5432/db?schema=tickets')).toBe('tickets'));

  it('defaults to tickets when absent or unparsable', () => {
    expect(schemaOf('postgresql://u:p@h:5432/db')).toBe('tickets');
    expect(schemaOf('not a url')).toBe('tickets');
  });
});
