import type { HttpService } from '@nestjs/axios';
import { isAxiosError, type AxiosResponse } from 'axios';
import { firstValueFrom } from 'rxjs';
import { UpstreamTimeoutError, UpstreamUnavailableError } from '../payments/domain/errors';

export type DownstreamName = 'ticket-service' | 'ledger-service';

// ERR_CANCELED is what axios reports when the AbortSignal.timeout() below fires,
// so it means "hard timeout" here and must map to UpstreamTimeoutError.
const TIMEOUT_CODES = new Set(['ECONNABORTED', 'ETIMEDOUT', 'ERR_CANCELED']);

export interface DownstreamRequest {
  method: 'GET' | 'POST';
  url: string;
  apiKey: string;
  correlationId: string;
  body?: unknown;
}

/**
 * One outbound call. Resolves with the response whatever its status (the module
 * sets validateStatus to accept all), so callers map statuses themselves.
 * Transport failures become UpstreamTimeoutError or UpstreamUnavailableError;
 * their messages carry the downstream name and the error code only, never a
 * URL, key or body.
 */
export async function callDownstream(
  http: HttpService,
  downstream: DownstreamName,
  req: DownstreamRequest,
): Promise<AxiosResponse<unknown>> {
  // axios `timeout` only fires on an idle socket, so a reply that trickles a byte at a
  // time would never trip it. The signal bounds the whole call (the claiming
  // transaction's timeout budget in OutboxRepository relies on that).
  const timeoutMs = http.axiosRef.defaults.timeout;
  try {
    return await firstValueFrom(
      http.request<unknown>({
        ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
        method: req.method,
        url: req.url,
        data: req.body,
        headers: {
          'X-Api-Key': req.apiKey,
          'X-Correlation-Id': req.correlationId,
          'Content-Type': 'application/json',
        },
      }),
    );
  } catch (error) {
    const code = isAxiosError(error) ? error.code : undefined;
    if (code !== undefined && TIMEOUT_CODES.has(code)) {
      throw new UpstreamTimeoutError(`${downstream} timed out`);
    }
    throw new UpstreamUnavailableError(`${downstream} is unreachable${code ? ` (${code})` : ''}`);
  }
}

export function unexpectedStatus(downstream: DownstreamName, status: number): Error {
  return new UpstreamUnavailableError(`${downstream} answered with unexpected status ${status}`);
}

/** The `code` of an error envelope, or undefined when the body is not one. */
export function errorCodeOf(body: unknown): string | undefined {
  if (typeof body === 'object' && body !== null && 'code' in body) {
    const code = body.code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}
