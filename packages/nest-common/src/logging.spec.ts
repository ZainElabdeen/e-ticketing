import { Writable } from 'node:stream';
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
});
