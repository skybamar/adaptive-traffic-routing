import { describe, expect, it } from 'vitest';
import { LatencyTracker } from '../src/latency';

describe('LatencyTracker', () => {
  it('takes the first sample as is and smooths the following ones', () => {
    const tracker = new LatencyTracker();

    expect(tracker.record('NRT', 'asia', 40, 0)).toEqual({ asia: 40 });
    tracker.record('NRT', 'asia', 140, 1_000);
    expect(tracker.record('NRT', 'asia', 140, 20_000)).toEqual({ asia: 76 });
  });

  it('starts from the row read from KV', () => {
    const tracker = new LatencyTracker();
    tracker.seed('NRT', { eu: 220, na: 130, asia: 35 });

    expect(tracker.record('NRT', 'asia', 85, 0)).toEqual({ eu: 220, na: 130, asia: 45 });
  });

  it('asks for a write at most every ten seconds', () => {
    const tracker = new LatencyTracker();

    expect(tracker.record('PRG', 'eu', 20, 0)).toBeDefined();
    expect(tracker.record('PRG', 'eu', 20, 5_000)).toBeUndefined();
    expect(tracker.record('PRG', 'eu', 20, 10_000)).toBeDefined();
  });

  it('keeps colos apart', () => {
    const tracker = new LatencyTracker();
    tracker.record('PRG', 'eu', 20, 0);

    expect(tracker.record('NRT', 'eu', 220, 0)).toEqual({ eu: 220 });
  });
});
