export class ApiError extends Error {
  status: number;
  code: string;
  correlationId?: string;
  retryAfterSeconds?: number;

  constructor(init: {
    status: number;
    code: string;
    message: string;
    correlationId?: string;
    retryAfterSeconds?: number;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    if (init.correlationId !== undefined) this.correlationId = init.correlationId;
    if (init.retryAfterSeconds !== undefined) this.retryAfterSeconds = init.retryAfterSeconds;
  }
}

type Result<T> = { data?: T; error?: unknown; response: Response };

function isEnvelope(
  body: unknown,
): body is { code: string; message?: unknown; correlationId?: unknown } {
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as { code?: unknown }).code === 'string'
  );
}

/** Returns `data`, or throws an ApiError built from the gateway error envelope. */
export function unwrap<T>(r: Result<T>): T {
  if (r.error === undefined && r.response.ok) return r.data as T;

  const { status } = r.response;
  const body = r.error;
  const retryAfter = Number(r.response.headers.get('Retry-After'));
  const init: ConstructorParameters<typeof ApiError>[0] = isEnvelope(body)
    ? {
        status,
        code: body.code,
        message: typeof body.message === 'string' ? body.message : body.code,
      }
    : { status, code: 'INTERNAL_ERROR', message: `Request failed with status ${status}` };
  if (isEnvelope(body) && typeof body.correlationId === 'string') {
    init.correlationId = body.correlationId;
  }
  if (status === 429 && Number.isFinite(retryAfter) && retryAfter > 0) {
    init.retryAfterSeconds = retryAfter;
  }
  throw new ApiError(init);
}

/** Awaits an openapi-fetch call; maps a fetch rejection to ApiError(0, NETWORK_ERROR). */
export async function call<T>(p: Promise<Result<T>>): Promise<T> {
  let result: Result<T>;
  try {
    result = await p;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError({ status: 0, code: 'NETWORK_ERROR', message: 'Network request failed' });
  }
  return unwrap(result);
}
