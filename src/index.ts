import { CircuitBreaker } from './breaker';
import { measureOrigins, shouldExplore } from './exploration';
import { geolocation } from './geo';
import { LatencyTracker } from './latency';
import { fetchOrigin, isRetriable, withRoutingHeaders } from './origin';
import { probeRegions } from './probe';
import type { Region } from './regions';
import { rankRegions } from './routing';
import { markRegionDown, readRoutingState, writeRtt } from './state';

const MAX_ATTEMPTS = 2;

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
  const candidates = await rankCandidates(colo, continent, env);
  const attempts = candidates.slice(0, isRetriable(request) ? MAX_ATTEMPTS : 1);

  for (const [attempt, region] of attempts.entries()) {
    const startedAt = Date.now();
    const response = await fetchOrigin(region, request, env);
    if (response) {
      recordSuccess(region, colo, Date.now() - startedAt, env, ctx);
      if (shouldExplore(Number(env.EXPLORE_SAMPLE_RATE))) {
        ctx.waitUntil(exploreOthers(colo, candidates.filter((other) => other !== region), env));
      }
      return withRoutingHeaders(response, region, attempt === 0 ? 'best' : 'failover', colo);
    }
    recordFailure(region, colo, env, ctx);
  }

  return new Response('No region available', { status: 503, headers: { 'retry-after': '5' } });
}

async function rankCandidates(colo: string, continent: string, env: Env): Promise<Region[]> {
  const state = await readRoutingState(env.STATE, colo);
  latency.seed(colo, state.rtt);
  const excluded = new Set([...(state.excluded ?? []), ...breaker.getOpenRegions()]);
  return rankRegions({ ...state, excluded }, { continent });
}

function recordSuccess(region: Region, colo: string, elapsedMs: number, env: Env, ctx: ExecutionContext): void {
  breaker.recordSuccess(region);
  const rtt = latency.record(colo, region, elapsedMs);
  if (rtt) ctx.waitUntil(writeRtt(env.STATE, colo, rtt));
}

async function exploreOthers(colo: string, regions: Region[], env: Env): Promise<void> {
  const rtt = latency.recordAll(colo, await measureOrigins(regions, env));
  if (rtt) await writeRtt(env.STATE, colo, rtt);
}

function recordFailure(region: Region, colo: string, env: Env, ctx: ExecutionContext): void {
  if (breaker.recordFailure(region)) {
    ctx.waitUntil(markRegionDown(env.STATE, region, colo));
  }
}
