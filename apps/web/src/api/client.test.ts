import { createApi } from './client';

function recorder() {
  const requests: Request[] = [];
  const fetchImpl = ((input: Request) => {
    requests.push(input);
    return Promise.resolve(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as unknown as typeof fetch;
  return { requests, fetchImpl };
}

describe('createApi', () => {
  it('sends the bearer token on backoffice paths only', async () => {
    const { requests, fetchImpl } = recorder();
    const api = createApi({ fetch: fetchImpl, getToken: () => 't' });
    await api.GET('/v1/backoffice/accounts');
    await api.GET('/v1/ticket-types');
    expect(requests[0]?.headers.get('authorization')).toBe('Bearer t');
    expect(requests[1]?.headers.has('authorization')).toBe(false);
  });

  it('sends no token when getToken returns null', async () => {
    const { requests, fetchImpl } = recorder();
    const api = createApi({ fetch: fetchImpl, getToken: () => null });
    await api.GET('/v1/backoffice/accounts');
    expect(requests[0]?.headers.has('authorization')).toBe(false);
  });

  it('defaults the base URL to /api', async () => {
    const { requests, fetchImpl } = recorder();
    const api = createApi({ fetch: fetchImpl });
    await api.GET('/v1/ticket-types');
    expect(new URL(requests[0]!.url, 'http://localhost').pathname).toMatch(/^\/api\/v1\//u);
  });
});
