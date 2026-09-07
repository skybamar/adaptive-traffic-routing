import type { Region } from './regions';

const ORIGIN_TIMEOUT_MS = 2000;
const RETRIABLE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function fetchOrigin(region: Region, request: Request, env: Env): Promise<Response | undefined> {
  const { pathname, search } = new URL(request.url);

  try {
    const response = await fetch(new URL(pathname + search, env.ORIGIN_URL), {
      method: request.method,
      headers: { 'x-region': region },
      signal: AbortSignal.timeout(ORIGIN_TIMEOUT_MS),
    });
    return response.status < 500 ? response : undefined;
  } catch {
    return undefined;
  }
}

export function isRetriable(request: Request): boolean {
  return RETRIABLE_METHODS.has(request.method) || request.headers.has('idempotency-key');
}

export function withRoutingHeaders(response: Response, region: Region, reason: string, colo: string): Response {
  const headers = new Headers(response.headers);
  headers.set('x-served-region', region);
  headers.set('x-route-reason', reason);
  headers.set('x-colo', colo);
  return new Response(response.body, { status: response.status, headers });
}
