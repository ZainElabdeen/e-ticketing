import { CORRELATION_HEADER, correlationIdMiddleware, correlationIdOf } from './correlation-id';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function run(header?: string) {
  const req: { headers: Record<string, string>; correlationId?: string } = { headers: {} };
  if (header !== undefined) {
    req.headers[CORRELATION_HEADER] = header;
  }
  const set = jest.fn();
  const next = jest.fn();
  correlationIdMiddleware(req, { setHeader: set }, next);
  return { req, set, next };
}

describe('correlation id', () => {
  it('keeps a UUID header', () => {
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    const { req, set, next } = run(id);
    expect(req.correlationId).toBe(id);
    expect(set).toHaveBeenCalledWith(CORRELATION_HEADER, id);
    expect(next).toHaveBeenCalled();
  });

  it('replaces a value that is not a UUID', () => {
    const { req } = run('not-a-uuid');
    expect(req.correlationId).toMatch(UUID_V4);
  });

  it('creates one when the header is missing and sets the response header', () => {
    const { req, set } = run();
    expect(req.correlationId).toMatch(UUID_V4);
    expect(set).toHaveBeenCalledWith(CORRELATION_HEADER, req.correlationId);
  });

  it('returns the same id on repeated calls', () => {
    const req = { headers: {} };
    expect(correlationIdOf(req)).toBe(correlationIdOf(req));
  });
});
