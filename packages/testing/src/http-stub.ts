import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface StubCall {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

/** `'drop'` destroys the socket, so the caller sees a connection error. */
export type StubReply = { status: number; body?: unknown; delayMs?: number } | 'drop';

export interface HttpStub {
  url: string;
  calls: StubCall[];
  /** The last registration matching a request wins. */
  on(method: string, pathPattern: RegExp, reply: StubReply | ((call: StubCall) => StubReply)): void;
  /** Clears recorded calls and registered handlers. */
  reset(): void;
  close(): Promise<void>;
}

interface Handler {
  method: string;
  pattern: RegExp;
  reply: StubReply | ((call: StubCall) => StubReply);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (text === '') {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function send(res: ServerResponse, status: number, body?: unknown): void {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(payload);
}

/** A loopback HTTP server for tests; stands in for a downstream service. */
export async function startHttpStub(): Promise<HttpStub> {
  const calls: StubCall[] = [];
  let handlers: Handler[] = [];
  // Delayed replies park a timer; close() and reset() must not leave them running.
  const pendingDelays = new Set<{ timer: NodeJS.Timeout; release: () => void }>();

  function cancelDelays(): void {
    for (const pending of pendingDelays) {
      clearTimeout(pending.timer);
      pending.release();
    }
    pendingDelays.clear();
  }

  const server = createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      // A throwing reply function or an unreadable body must answer, not hang the caller.
      if (res.headersSent) {
        res.destroy();
        return;
      }
      send(res, 500, { error: error instanceof Error ? error.message : String(error) });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const call: StubCall = {
      method: req.method ?? 'GET',
      path: req.url ?? '/',
      headers: req.headers,
      body: await readBody(req),
    };
    calls.push(call);
    const pathOnly = call.path.split('?')[0] ?? '';
    const handler = [...handlers]
      .reverse()
      .find((h) => h.method === call.method && h.pattern.test(pathOnly));
    if (!handler) {
      send(res, 599, { error: 'no stub' });
      return;
    }
    const reply = typeof handler.reply === 'function' ? handler.reply(call) : handler.reply;
    if (reply === 'drop') {
      req.socket.destroy();
      return;
    }
    if (reply.delayMs) {
      const completed = await new Promise<boolean>((resolve) => {
        const pending = {
          timer: setTimeout(() => {
            pendingDelays.delete(pending);
            resolve(true);
          }, reply.delayMs),
          release: () => resolve(false),
        };
        pendingDelays.add(pending);
      });
      if (!completed) {
        res.destroy();
        return;
      }
    }
    send(res, reply.status, reply.body);
  }

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    on: (method, pathPattern, reply) => {
      handlers.push({ method: method.toUpperCase(), pattern: pathPattern, reply });
    },
    reset: () => {
      cancelDelays();
      calls.length = 0;
      handlers = [];
    },
    close: () =>
      new Promise<void>((resolve) => {
        cancelDelays();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
