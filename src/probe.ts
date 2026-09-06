import { REGIONS, type Region } from './regions';
import type { RegionStatus } from './routing';
import { REGIONS_KEY, type RegionsValue } from './state';

const PROBE_TIMEOUT_MS = 2000;

export async function probeRegions(env: Env): Promise<RegionsValue> {
  const statuses = await Promise.all(REGIONS.map((region) => probeRegion(region, env)));
  const regions = Object.fromEntries(REGIONS.map((region, index) => [region, statuses[index]])) as RegionsValue;
  await env.STATE.put(REGIONS_KEY, JSON.stringify(regions));
  return regions;
}

async function probeRegion(region: Region, env: Env): Promise<RegionStatus> {
  try {
    const response = await fetch(new URL('/health', env.ORIGIN_URL), {
      headers: { 'x-region': region, authorization: `Bearer ${env.PROBE_TOKEN}` },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return { healthy: false, load: 1 };

    const { load } = await response.json<{ load?: number }>();
    return { healthy: true, load: load ?? 0 };
  } catch {
    return { healthy: false, load: 1 };
  }
}
