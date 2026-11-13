import { startHttpStub, type HttpStub } from '../src';

describe('startHttpStub', () => {
  let stub: HttpStub;

  beforeEach(async () => {
    stub = await startHttpStub();
  });

  afterEach(async () => {
    await stub.close();
  });

  it('replies with the registered JSON and status', async () => {
    stub.on('GET', /^\/a$/, { status: 201, body: { ok: true } });
    const res = await fetch(`${stub.url}/a`);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('records method, path, headers and the parsed body', async () => {
    stub.on('POST', /^\/b/, { status: 200 });
    await fetch(`${stub.url}/b?x=1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'k' },
      body: JSON.stringify({ n: 1 }),
    });
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]).toMatchObject({
      method: 'POST',
      path: '/b?x=1',
      headers: { 'x-api-key': 'k' },
      body: { n: 1 },
    });
  });

  it('holds the reply for delayMs', async () => {
    stub.on('GET', /^\/slow$/, { status: 200, delayMs: 200 });
    const t0 = Date.now();
    await fetch(`${stub.url}/slow`);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(190);
  });

  it("'drop' makes the fetch reject", async () => {
    stub.on('GET', /^\/drop$/, 'drop');
    await expect(fetch(`${stub.url}/drop`)).rejects.toThrow();
  });

  it('accepts a function reply and lets the last registration win', async () => {
    stub.on('GET', /^\/c$/, { status: 200 });
    stub.on('GET', /^\/c$/, (call) => ({ status: 202, body: { path: call.path } }));
    const res = await fetch(`${stub.url}/c`);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ path: '/c' });
  });

  it('answers 599 to an unmatched request', async () => {
    const res = await fetch(`${stub.url}/nothing`);
    expect(res.status).toBe(599);
    expect(await res.json()).toEqual({ error: 'no stub' });
  });

  it('reset clears calls and handlers', async () => {
    stub.on('GET', /^\/d$/, { status: 200 });
    await fetch(`${stub.url}/d`);
    stub.reset();
    expect(stub.calls).toHaveLength(0);
    expect((await fetch(`${stub.url}/d`)).status).toBe(599);
  });
});
