import { REGIONS, type Region } from './regions';

const FAILURES_TO_OPEN = 2;
const OPEN_FOR_MS = 30_000;

interface RegionState {
  failures: number;
  openedAt?: number;
}

export class CircuitBreaker {
  private readonly states = new Map<Region, RegionState>();

  isOpen(region: Region, now = Date.now()): boolean {
    const openedAt = this.states.get(region)?.openedAt;
    return openedAt !== undefined && now - openedAt < OPEN_FOR_MS;
  }

  openRegions(now = Date.now()): ReadonlySet<Region> {
    return new Set(REGIONS.filter((region) => this.isOpen(region, now)));
  }

  recordSuccess(region: Region): void {
    this.states.delete(region);
  }

  recordFailure(region: Region, now = Date.now()): boolean {
    const wasOpen = this.isOpen(region, now);
    const state = this.states.get(region) ?? { failures: 0 };
    state.failures += 1;
    if (state.failures >= FAILURES_TO_OPEN) {
      state.openedAt = now;
    }
    this.states.set(region, state);
    return !wasOpen && this.isOpen(region, now);
  }
}
