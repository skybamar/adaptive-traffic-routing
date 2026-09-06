import type { Region } from './regions';
import type { RttValue } from './state';

const SMOOTHING = 0.2;
const FLUSH_INTERVAL_MS = 10_000;

interface ColoLatency {
  rtt: RttValue;
  flushedAt?: number;
}

export class LatencyTracker {
  private readonly colos = new Map<string, ColoLatency>();

  seed(colo: string, rtt: RttValue | undefined): void {
    if (rtt && !this.colos.has(colo)) {
      this.colos.set(colo, { rtt: { ...rtt } });
    }
  }

  record(colo: string, region: Region, sampleMs: number, now = Date.now()): RttValue | undefined {
    const entry = this.colos.get(colo) ?? { rtt: {} };
    const previous = entry.rtt[region];
    entry.rtt[region] = previous === undefined ? sampleMs : previous + SMOOTHING * (sampleMs - previous);
    this.colos.set(colo, entry);

    if (entry.flushedAt !== undefined && now - entry.flushedAt < FLUSH_INTERVAL_MS) return undefined;
    entry.flushedAt = now;
    return { ...entry.rtt };
  }
}
