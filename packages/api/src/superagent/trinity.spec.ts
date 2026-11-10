import { trinityMetrics } from './trinity';

describe('trinityMetrics', () => {
  it('reads the execution receipt fields Trinity reports', () => {
    expect(
      trinityMetrics({
        duration_ms: 12_000,
        cost: 0.0421,
        context_used: 8_000,
        context_max: 200_000,
      }),
    ).toEqual({ durationMs: 12_000, costUsd: 0.0421, contextUsed: 8_000, contextMax: 200_000 });
  });

  it('omits fields the receipt does not carry instead of inventing zeros', () => {
    expect(trinityMetrics({ status: 'success' })).toEqual({});
    expect(trinityMetrics(undefined)).toEqual({});
    expect(trinityMetrics({ cost: null, duration_ms: 'fast' })).toEqual({});
  });
});
