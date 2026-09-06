export type Region = 'eu' | 'na' | 'asia';

export const REGIONS: readonly Region[] = ['eu', 'na', 'asia'];

// Fallback RTT estimates (ms) per continent, used until the colo has its own measurements.
// Continent codes are coarse: "AS" spans Tokyo and Dubai, hence the near tie between eu and na.
export const STATIC_LATENCY: Record<string, Record<Region, number>> = {
  EU: { eu: 20, na: 90, asia: 170 },
  NA: { eu: 90, na: 20, asia: 200 },
  SA: { eu: 190, na: 120, asia: 320 },
  AS: { eu: 160, na: 170, asia: 40 },
  OC: { eu: 280, na: 160, asia: 100 },
  AF: { eu: 120, na: 200, asia: 250 },
  AN: { eu: 300, na: 300, asia: 300 },
};

export const DEFAULT_LATENCY: Record<Region, number> = { eu: 150, na: 150, asia: 150 };
