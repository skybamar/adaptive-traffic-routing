import { REGIONS, type Region } from './regions';
import type { RegionStatus, RoutingState } from './routing';

const KV_CACHE_TTL_SECONDS = 60;
const DOWN_MARKER_TTL_SECONDS = 180;

export const REGIONS_KEY = 'regions';
export const rttKey = (colo: string) => `rtt:${colo}`;
export const downKey = (region: Region) => `down:${region}`;

export type RegionsValue = Partial<Record<Region, RegionStatus>>;
export type RttValue = Partial<Record<Region, number>>;

export async function readRoutingState(kv: KVNamespace, colo: string): Promise<RoutingState> {
  const [regions, rtt, markers] = await Promise.all([
    kv.get<RegionsValue>(REGIONS_KEY, { type: 'json', cacheTtl: KV_CACHE_TTL_SECONDS }),
    kv.get<RttValue>(rttKey(colo), { type: 'json', cacheTtl: KV_CACHE_TTL_SECONDS }),
    Promise.all(REGIONS.map((region) => kv.get(downKey(region), { cacheTtl: KV_CACHE_TTL_SECONDS }))),
  ]);

  const markedDown = REGIONS.filter((_, index) => markers[index] !== null);

  return { regions: regions ?? undefined, rtt: rtt ?? undefined, excluded: new Set(markedDown) };
}

export function markDown(kv: KVNamespace, region: Region, colo: string): Promise<void> {
  const marker = JSON.stringify({ at: new Date().toISOString(), colo });
  return kv.put(downKey(region), marker, { expirationTtl: DOWN_MARKER_TTL_SECONDS });
}
