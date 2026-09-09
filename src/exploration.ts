import { fetchOrigin } from './origin';
import type { Region } from './regions';
import type { RttValue } from './state';

export function shouldExplore(rate: number, random: () => number = Math.random): boolean {
  return random() < rate;
}

export async function measureOrigins(regions: Region[], env: Env): Promise<RttValue> {
  const probe = new Request(new URL('/time', env.ORIGIN_URL));
  const samples = await Promise.all(
    regions.map(async (region) => {
      const startedAt = Date.now();
      const response = await fetchOrigin(region, probe, env);
      return [region, response ? Date.now() - startedAt : undefined] as const;
    }),
  );
  return Object.fromEntries(samples.filter(([, elapsedMs]) => elapsedMs !== undefined));
}
