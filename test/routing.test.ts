import { describe, expect, it } from 'vitest';
import { rankRegions } from '../src/routing';

const healthy = { healthy: true, load: 0.3 };

describe('rankRegions', () => {
  it('falls back to the static continent table without any state', () => {
    expect(rankRegions({}, { continent: 'EU' })).toEqual(['eu', 'na', 'asia']);
    expect(rankRegions({}, { continent: 'AS' })).toEqual(['asia', 'eu', 'na']);
    expect(rankRegions({}, { continent: 'OC' })).toEqual(['asia', 'na', 'eu']);
  });

  it('still ranks all regions for an unknown continent', () => {
    expect(rankRegions({}, { continent: 'T1' })).toHaveLength(3);
  });

  it('prefers measured latency over the static table', () => {
    const rtt = { eu: 230, na: 120, asia: 60 };
    expect(rankRegions({ rtt }, { continent: 'AS' })).toEqual(['asia', 'na', 'eu']);
  });

  it('skips unhealthy and excluded regions', () => {
    const regions = { eu: healthy, na: healthy, asia: { healthy: false, load: 0.1 } };
    expect(rankRegions({ regions }, { continent: 'AS' })).toEqual(['eu', 'na']);

    const excluded = new Set<'eu'>(['eu']);
    expect(rankRegions({ regions, excluded }, { continent: 'AS' })).toEqual(['na']);
  });

  it('returns nothing when no region is available', () => {
    const down = { healthy: false, load: 0 };
    expect(rankRegions({ regions: { eu: down, na: down, asia: down } }, { continent: 'EU' })).toEqual([]);
  });

  it('moves traffic away from a region only once it is really busy', () => {
    const rtt = { eu: 160, na: 170, asia: 40 };
    const busy = (load: number) => ({ eu: healthy, na: healthy, asia: { healthy: true, load } });

    expect(rankRegions({ rtt, regions: busy(0.7) }, { continent: 'AS' })[0]).toBe('asia');
    expect(rankRegions({ rtt, regions: busy(0.85) }, { continent: 'AS' })[0]).toBe('asia');
    expect(rankRegions({ rtt, regions: busy(0.95) }, { continent: 'AS' })[0]).toBe('eu');
  });

  it('sticks to the previous region unless another one is clearly better', () => {
    const rtt = { eu: 30, na: 20, asia: 200 };
    expect(rankRegions({ rtt }, { continent: 'EU', previous: 'eu' })[0]).toBe('eu');
    expect(rankRegions({ rtt: { ...rtt, na: 5 } }, { continent: 'EU', previous: 'eu' })[0]).toBe('na');
  });
});
