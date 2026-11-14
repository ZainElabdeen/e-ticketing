import { ApiError, call, unwrap } from './errors';

const envelope = (statusCode: number, code: string) => ({
  statusCode,
  code,
  message: 'm',
  correlationId: 'c-1',
});

describe('unwrap', () => {
  it('returns data on success', () => {
    expect(unwrap({ data: { a: 1 }, response: new Response(null, { status: 200 }) })).toEqual({
      a: 1,
    });
  });

  it('maps a 409 envelope', () => {
    const response = new Response(null, { status: 409 });
    try {
      unwrap({ error: envelope(409, 'QUOTA_EXCEEDED'), response });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect(e).toMatchObject({ status: 409, code: 'QUOTA_EXCEEDED', correlationId: 'c-1' });
    }
  });

  it('reads Retry-After on a 429', () => {
    const response = new Response(null, { status: 429, headers: { 'Retry-After': '7' } });
    expect(() => unwrap({ error: envelope(429, 'RATE_LIMITED'), response })).toThrow(
      expect.objectContaining({ code: 'RATE_LIMITED', retryAfterSeconds: 7 }),
    );
  });

  it('maps a non-envelope body to INTERNAL_ERROR', () => {
    const response = new Response('<html>bad gateway</html>', {
      status: 502,
      headers: { 'content-type': 'text/html' },
    });
    expect(() => unwrap({ error: '<html>bad gateway</html>', response })).toThrow(
      expect.objectContaining({ status: 502, code: 'INTERNAL_ERROR' }),
    );
  });
});

describe('call', () => {
  it('maps a fetch rejection to NETWORK_ERROR with status 0', async () => {
    await expect(call(Promise.reject(new TypeError('Failed to fetch')))).rejects.toMatchObject({
      status: 0,
      code: 'NETWORK_ERROR',
    });
  });

  it('passes ApiError through and returns data', async () => {
    await expect(
      call(Promise.resolve({ data: 5, response: new Response(null, { status: 200 }) })),
    ).resolves.toBe(5);
  });
});
