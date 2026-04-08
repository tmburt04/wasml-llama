import type { EventSink } from './events.js';

export interface ModelLoadSessionOptions {
  totalBytes?: number;
  expectedChunks?: number;
}

export interface ModelLoadSummary {
  bytesLoaded: number;
  chunksLoaded: number;
  modelId: string;
  memoryRequiredBytes: number;
}

export interface InferenceSamplingOptions {
  temperature?: number;
  topP?: number;
  topK?: number;
  seed?: number;
}

export interface InferenceRequest {
  requestId: string;
  prompt: string;
  maxTokens?: number;
  sampling?: InferenceSamplingOptions;
  mode?: 'stream' | 'bulk';
  /** Number of tokens to generate per WASM call in stream mode (default: 8). Higher values reduce JS↔WASM overhead. */
  streamBatchSize?: number;
  signal?: AbortSignal;
}

export interface TokenChunk {
  requestId: string;
  token: string;
  tokenIndex: number;
  isSpecial: boolean;
}

export interface InferenceStep {
  done: boolean;
  stopReason?: 'completed' | 'cancelled' | 'error';
  token?: string;
  tokenCount?: number;
  isSpecial?: boolean;
}

export interface InferenceSummary {
  requestId: string;
  generatedTokens: number;
  stopReason: 'completed' | 'cancelled' | 'error';
}

export interface BulkInferenceResult extends InferenceSummary {
  text: string;
}

export interface MemorySnapshot {
  usedBytes: number;
  limitBytes: number | null;
}

export interface GenerateAllResult {
  text: string;
  tokenCount: number;
  done: boolean;
}

export interface WasmAdapter {
  initialize(eventSink: EventSink): Promise<void>;
  beginModelLoad(options: ModelLoadSessionOptions): Promise<void>;
  writeModelChunk(chunk: Uint8Array): Promise<void>;
  finalizeModelLoad(): Promise<ModelLoadSummary>;
  beginInference(request: InferenceRequest): Promise<void>;
  stepInference(requestId: string, maxTokens?: number): Promise<InferenceStep>;
  generateAll(requestId: string, maxTokens: number): Promise<GenerateAllResult>;
  cancelInference(requestId: string): Promise<void>;
  getMemorySnapshot(): MemorySnapshot;
  destroy(): Promise<void>;
}
