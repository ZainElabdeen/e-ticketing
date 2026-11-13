import { nextAttemptDelaySeconds } from './backoff';

describe('nextAttemptDelaySeconds', () => {
  it.each([
    [1, 2],
    [2, 4],
    [8, 256],
    [9, 300],
    [10, 300],
  ])('attempts %i gives %i s', (a, s) => expect(nextAttemptDelaySeconds(a)).toBe(s));
});
