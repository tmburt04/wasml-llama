import { describe, expect, it } from 'vitest';
import { estimateMemoryRequirement } from '@wasml-llama/tooling';

describe('estimateMemoryRequirement', () => {
  it('accounts for kv cache and memory64 overhead', () => {
    const estimate = estimateMemoryRequirement({
      modelBytes: 1024,
      contextTokens: 2048,
      threads: 2,
      memory64: true,
    });
    expect(estimate.totalBytes).toBeGreaterThan(estimate.modelBytes);
    expect(estimate.kvCacheBytes).toBe(2048 * 2048);
  });
});
