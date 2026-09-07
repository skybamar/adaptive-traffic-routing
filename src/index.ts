import { CircuitBreaker } from './breaker';
import { LatencyTracker } from './latency';
import type { Region } from './regions';
import { rankRegions } from './routing';
import { probeRegions } from './probe';
import { markRegionDown, readRoutingState, writeRtt } from './state';

const ORIGIN_TIMEOUT_MS = 2000;
const RETRIABLE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const breaker = new CircuitBreaker();
const latency = new LatencyTracker();

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);

    switch (pathname) {
      case '/healthz':
        return new Response('ok');
      case '/time':
        return routeToOrigin(request, env, ctx);
      default:
        return new Response('Not found', { status: 404 });
    }
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await probeRegions(env);
  },
} satisfies ExportedHandler<Env>;

async function routeToOrigin(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const { colo, continent } = geolocation(request, env);
  const state = await readRoutingState(env.STATE, colo);
  latency.seed(colo, state.rtt);
  const excluded = new Set([...(state.excluded ?? []), ...breaker.getOpenRegions()]);
  const candidates = rankRegions({ ...state, excluded }, { continent });
  const attempts = candidates.slice(0, isRetriable(request) ? 2 : 1);

  for (const [attempt, region] of attempts.entries()) {
    const startedAt = Date.now();
    const response = await fetchOrigin(region, request, env);
    if (response) {
      breaker.recordSuccess(region);
      const rtt = latency.record(colo, region, Date.now() - startedAt);
      if (rtt) ctx.waitUntil(writeRtt(env.STATE, colo, rtt));
      return withRoutingHeaders(response, region, attempt === 0 ? 'best' : 'failover', colo);
    }
    if (breaker.recordFailure(region)) {
      ctx.waitUntil(markRegionDown(env.STATE, region, colo));
    }
  }

  return new Response('No region available', { status: 503, headers: { 'retry-after': '5' } });
}

async function fetchOrigin(region: Region, request: Request, env: Env): Promise<Response | undefined> {
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

function withRoutingHeaders(response: Response, region: Region, reason: string, colo: string): Response {
  const headers = new Headers(response.headers);
  headers.set('x-served-region', region);
  headers.set('x-route-reason', reason);
  headers.set('x-colo', colo);
  return new Response(response.body, { status: response.status, headers });
}

function isRetriable(request: Request): boolean {
  return RETRIABLE_METHODS.has(request.method) || request.headers.has('idempotency-key');
}

function geolocation(request: Request, env: Env): { colo: string; continent: string } {
  const cf = request.cf as IncomingRequestCfProperties | undefined;
  const override = (name: string) => (env.DEBUG === 'true' ? request.headers.get(name) : null);
  return {
    colo: override('x-debug-colo') || cf?.colo || 'unknown',
    continent: override('x-debug-continent') || cf?.continent || 'unknown',
  };
}
