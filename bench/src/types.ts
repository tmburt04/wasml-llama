export type BenchBackend = 'webgpu' | 'cpu';
export type BenchEnvironment = 'chrome' | 'node';
export type InferenceMode = 'stream' | 'bulk';

export interface BenchModelConfig {
  id: string;
  filename: string;
  sourceUrl: string;
  bytes?: number;
  prompt: string;
  maxTokens: number;
}

export interface BenchArtifactConfig {
  version: string;
  target: 'core' | 'extended' | 'debug';
  backend: BenchBackend;
  manifestPath?: string;
}

export interface BenchRunConfig {
  model: BenchModelConfig;
  artifact: BenchArtifactConfig;
  environment: BenchEnvironment;
  preferWebGpu: boolean;
  prompt: string;
  maxTokens: number;
  inferenceMode?: InferenceMode;
  chromeExecutablePath?: string | undefined;
}

export interface BenchMetrics {
  startupLatencyMs: number;
  downloadLatencyMs: number;
  modelLoadLatencyMs: number;
  promptLatencyMs: number;
  decodeLatencyMs: number;
  tokensPerSecond: number;
  peakMemoryBytes: number;
}

export interface BenchEnvironmentDetails {
  compatibilityKey: string;
  browserVersion?: string;
  flagHash?: string;
  flags?: string[];
  headless?: boolean;
  os?: string;
  platform?: string;
  userAgent?: string;
  nodeVersion?: string;
}

export interface BenchSample {
  commit: string;
  version: string;
  modelId: string;
  backend: BenchBackend;
  environment: BenchEnvironment;
  environmentDetails: BenchEnvironmentDetails;
  metrics: BenchMetrics;
  outputText: string;
  outputTokens: number;
  artifactSha256: string;
  upstreamCommit: string;
  recordedAt: string;
}

export interface BenchThresholds {
  startupLatencyPct: number;
  decodeTokensPerSecondPct: number;
  peakMemoryPct: number;
}

export interface BenchReport {
  samples: BenchSample[];
  regressions: string[];
  model: BenchModelConfig;
}
