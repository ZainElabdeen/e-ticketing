import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/env';
import { downstreamTimeoutMs } from './downstream-http';

const config = (value: unknown): ConfigService<EnvironmentVariables, true> =>
  ({ get: () => value }) as unknown as ConfigService<EnvironmentVariables, true>;

describe('downstreamTimeoutMs', () => {
  it('returns a positive timeout', () => {
    expect(downstreamTimeoutMs(config(5000))).toBe(5000);
  });

  it.each([0, -1, NaN, undefined, '5000'])('rejects %p', (value) => {
    expect(() => downstreamTimeoutMs(config(value))).toThrow(/DOWNSTREAM_TIMEOUT_MS/);
  });
});
