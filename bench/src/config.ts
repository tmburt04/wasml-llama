import type { BenchModelConfig, BenchThresholds } from './types.js';

export const DEFAULT_MODEL: BenchModelConfig = {
  id: 'qwen3.5-0.8b-q4_k_m',
  filename: 'Qwen3.5-0.8B-Q4_K_M.gguf',
  sourceUrl: 'https://huggingface.co/lmstudio-community/Qwen3.5-0.8B-GGUF/resolve/main/Qwen3.5-0.8B-Q4_K_M.gguf?download=1',
  bytes: 528 * 1024 * 1024,
  prompt: 'Write one concise sentence about WebGPU benchmarking in browsers.',
  maxTokens: 48,
};

export const DEFAULT_THRESHOLDS: BenchThresholds = {
  startupLatencyPct: 15,
  decodeTokensPerSecondPct: 10,
  peakMemoryPct: 10,
};

export const DEFAULT_BROWSER_PORT = 41741;
