import { z } from 'zod';
import './zod-setup';

describe('zod-setup', () => {
  it('turns on jitless so zod never probes new Function under a strict CSP', () => {
    expect(z.config().jitless).toBe(true);
  });
});
