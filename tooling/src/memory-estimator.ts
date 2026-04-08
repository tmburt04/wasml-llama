export interface MemoryEstimateInput {
  modelBytes: number;
  contextTokens: number;
  threads: number;
  memory64: boolean;
}

export interface MemoryEstimate {
  modelBytes: number;
  kvCacheBytes: number;
  scratchBytes: number;
  totalBytes: number;
}

export function estimateMemoryRequirement(input: MemoryEstimateInput): MemoryEstimate {
  const kvCacheBytes = input.contextTokens * 2048;
  const scratchBase = Math.max(64 * 1024 * 1024, Math.floor(input.modelBytes * 0.1));
  const threadOverhead = input.threads * 8 * 1024 * 1024;
  const memory64Overhead = input.memory64 ? 16 * 1024 * 1024 : 0;
  const scratchBytes = scratchBase + threadOverhead + memory64Overhead;
  return {
    modelBytes: input.modelBytes,
    kvCacheBytes,
    scratchBytes,
    totalBytes: input.modelBytes + kvCacheBytes + scratchBytes,
  };
}
