import { trimTrailingSlashes } from './url';

describe('trimTrailingSlashes', () => {
  it.each([
    ['http://svc:3000', 'http://svc:3000'],
    ['http://svc:3000/', 'http://svc:3000'],
    ['http://svc:3000///', 'http://svc:3000'],
    ['http://svc:3000/base/', 'http://svc:3000/base'],
    ['/', ''],
    ['', ''],
  ])('%j -> %j', (input, expected) => {
    expect(trimTrailingSlashes(input)).toBe(expected);
  });

  it('is linear on a long run of slashes', () => {
    const input = `http://svc${'/'.repeat(100_000)}x`;
    expect(trimTrailingSlashes(input)).toBe(input);
  });
});
