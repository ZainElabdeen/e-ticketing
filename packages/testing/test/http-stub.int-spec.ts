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

  it('answers 500 with the message when a reply function throws', async () => {
    stub.on('GET', /^\/boom$/, () => {
      throw new Error('handler exploded');
    });
    const res = await fetch(`${stub.url}/boom`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'handler exploded' });
  });

  it('close() cancels a pending delayed reply instead of leaving its timer running', async () => {
    stub.on('GET', /^\/hang$/, { status: 200, delayMs: 60_000 });
    const pending = fetch(`${stub.url}/hang`).then(
      () => 'answered',
      () => 'failed',
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    const t0 = Date.now();
    await stub.close();
    expect(await pending).toBe('failed');
    expect(Date.now() - t0).toBeLessThan(2000);
    // afterEach closes again; closing a closed stub must still resolve.
  });

  it('reset() cancels a pending delayed reply', async () => {
    stub.on('GET', /^\/hang$/, { status: 200, delayMs: 60_000 });
    const pending = fetch(`${stub.url}/hang`).then(
      () => 'answered',
      () => 'failed',
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    stub.reset();
    expect(await pending).toBe('failed');
  });

  it('trickles the body one byte per chunkDelayMs after sending headers at once', async () => {
    stub.on('GET', /^\/slow$/, { status: 200, body: { a: 1 }, chunkDelayMs: 50 });
    const t0 = Date.now();
    const res = await fetch(`${stub.url}/slow`);
    expect(Date.now() - t0).toBeLessThan(40);
    expect(await res.json()).toEqual({ a: 1 });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(5 * 50 - 10);
  });

  it('reset() cancels a trickling reply', async () => {
    stub.on('GET', /^\/slow$/, { status: 200, body: { a: 'x'.repeat(200) }, chunkDelayMs: 1000 });
    const res = await fetch(`${stub.url}/slow`);
    const pending = res.text().then(
      () => 'answered',
      () => 'failed',
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    stub.reset();
    expect(await pending).toBe('failed');
  });
});
