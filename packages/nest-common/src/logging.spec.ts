import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import pinoHttp from 'pino-http';
import pino, { type LoggerOptions } from 'pino';
import { pinoHttpOptions } from './logging';

describe('pinoHttpOptions', () => {
  it('pinoHttpOptions sets base.service', () =>
    expect(pinoHttpOptions({ service: 's', level: 'info' }).base).toEqual({ service: 's' }));

  it('pinoHttpOptions redacts card number and cvc', () => {
    const opts = pinoHttpOptions({ service: 's', level: 'info' });
    expect(opts.redact).toEqual(
      expect.arrayContaining(['req.body.card.number', 'req.body.card.cvc']),
    );
  });

  it('includes extraRedact paths', () => {
    const opts = pinoHttpOptions({ service: 's', level: 'info', extraRedact: ['req.body.pin'] });
    expect(opts.redact).toEqual(expect.arrayContaining(['req.body.pin']));
  });

  it('actually redacts secrets and card data from a logged line', () => {
    let captured = '';
    const stream = new Writable({
      write(chunk: Buffer, _enc, cb) {
        captured += chunk.toString();
        cb();
      },
    });
    const opts = pinoHttpOptions({ service: 'x', level: 'info', stream });
    const logger = pino(opts as LoggerOptions, stream);
    logger.info({
      req: {
        headers: { 'x-api-key': 'SECRET-KEY-123' },
        body: { card: { number: '4242424242424242', cvc: '123' } },
      },
    });
    expect(captured).not.toContain('SECRET-KEY-123');
    expect(captured).not.toContain('4242424242424242');
    expect(captured).not.toContain('"cvc":"123"');
    expect(captured).toContain('[Redacted]');
  });

  it('puts exactly one service key on a request-completion line', async () => {
    let captured = '';
    const stream = new Writable({
      write(chunk: Buffer, _enc, cb) {
        captured += chunk.toString();
        cb();
      },
    });
    const logger = pinoHttp(pinoHttpOptions({ service: 'svc', level: 'info', stream }));
    const server = createServer((req, res) => {
      logger(req, res);
      res.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as AddressInfo;
      await fetch(`http://127.0.0.1:${port}/x`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      server.close();
    }
    const line = captured.trim().split('\n')[0] ?? '';
    expect(line).toContain('"statusCode":200');
    expect(line.match(/"service"/g)).toHaveLength(1);
  });
});
