import { describe, expect, it } from 'vitest';
import { shouldExplore } from '../src/exploration';

describe('shouldExplore', () => {
  it('samples the given share of requests', () => {
    expect(shouldExplore(0.01, () => 0.005)).toBe(true);
    expect(shouldExplore(0.01, () => 0.5)).toBe(false);
  });

  it('never samples when the rate is zero', () => {
    expect(shouldExplore(0, () => 0)).toBe(false);
  });
});
