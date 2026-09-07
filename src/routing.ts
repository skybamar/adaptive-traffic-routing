import { DEFAULT_LATENCY, REGIONS, STATIC_LATENCY, type Region } from './regions';

export interface RegionStatus {
  healthy: boolean;
  load: number;
}

export interface RoutingState {
  regions?: Partial<Record<Region, RegionStatus>>;
  rtt?: Partial<Record<Region, number>>;
  excluded?: ReadonlySet<Region>;
}

export interface RoutingContext {
  continent: string;
  previous?: Region;
}

const LOAD_PENALTY_START = 0.7;
const LOAD_PENALTY_MAX_MS = 400;
const STICKINESS_MS = 20;

export function rankRegions(state: RoutingState, ctx: RoutingContext): Region[] {
  return REGIONS.filter((region) => isAvailable(region, state))
    .map((region) => ({ region, score: scoreRegion(region, state, ctx) }))
    .sort((a, b) => a.score - b.score)
    .map(({ region }) => region);
}

function loadPenalty(load: number): number {
  if (load <= LOAD_PENALTY_START) return 0;
  const overload = Math.min(1, (load - LOAD_PENALTY_START) / (1 - LOAD_PENALTY_START));
  return Math.round(overload * overload * LOAD_PENALTY_MAX_MS);
}

function isAvailable(region: Region, state: RoutingState): boolean {
  return !state.excluded?.has(region) && state.regions?.[region]?.healthy !== false;
}

function scoreRegion(region: Region, state: RoutingState, ctx: RoutingContext): number {
  return expectedLatency(region, state, ctx) + loadPenalty(state.regions?.[region]?.load ?? 0) - stickinessBonus(region, ctx);
}

function expectedLatency(region: Region, state: RoutingState, ctx: RoutingContext): number {
  return state.rtt?.[region] ?? STATIC_LATENCY[ctx.continent]?.[region] ?? DEFAULT_LATENCY[region];
}

function stickinessBonus(region: Region, ctx: RoutingContext): number {
  return region === ctx.previous ? STICKINESS_MS : 0;
}
