import { createFault, type EventSink, type WasmAdapter } from '@wasml-llama/runtime-core';

export interface FakeAdapterOptions {
  failFinalizeAttempts?: number;
  failOnPartialModel?: boolean;
  memoryLimitBytes?: number;
}

export class FakeAdapter implements WasmAdapter {
  readonly #sessions = new Map<string, { tokens: string[]; index: number; cancelled: boolean }>();
  readonly #options: FakeAdapterOptions;
  #chunks: Uint8Array[] = [];
  #finalizeAttempts = 0;

  constructor(options: FakeAdapterOptions = {}) {
    this.#options = options;
  }

  async initialize(eventSink: EventSink): Promise<void> { void eventSink; }

  async beginModelLoad(): Promise<void> {
    this.#chunks = [];
  }

  async writeModelChunk(chunk: Uint8Array): Promise<void> {
    this.#chunks.push(chunk.slice());
    const total = this.#chunks.reduce((sum, current) => sum + current.byteLength, 0);
    const memoryLimitBytes = this.#options.memoryLimitBytes;
    if (memoryLimitBytes !== undefined && total > memoryLimitBytes) {
      throw createFault({
        category: 'memory',
        code: 'MEMORY_OVERFLOW',
        origin: 'runtime-core',
        severity: 'fatal',
        recoverable: false,
        message: 'memory overflow',
      });
    }
  }

  async finalizeModelLoad() {
    this.#finalizeAttempts += 1;
    if (this.#options.failFinalizeAttempts && this.#finalizeAttempts <= this.#options.failFinalizeAttempts) {
      throw createFault({
        category: 'model',
        code: 'MODEL_CORRUPTED',
        origin: 'runtime-core',
        severity: 'error',
        recoverable: true,
        message: 'model corrupted',
      });
    }
    const bytesLoaded = this.#chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    if (this.#options.failOnPartialModel && bytesLoaded < 3) {
      throw createFault({
        category: 'model',
        code: 'MODEL_PARTIAL_DOWNLOAD',
        origin: 'runtime-core',
        severity: 'error',
        recoverable: true,
        message: 'partial model download',
      });
    }
    return {
      bytesLoaded,
      chunksLoaded: this.#chunks.length,
      modelId: `fake-${bytesLoaded}`,
      memoryRequiredBytes: bytesLoaded * 2,
    };
  }

  async beginInference(request: { requestId: string; prompt: string; maxTokens?: number }): Promise<void> {
    const tokens = request.prompt.split(/\s+/).filter(Boolean);
    const emitted = request.maxTokens ? tokens.slice(0, request.maxTokens) : tokens;
    this.#sessions.set(request.requestId, { tokens: emitted, index: 0, cancelled: false });
  }

  async stepInference(requestId: string) {
    const session = this.#sessions.get(requestId);
    if (!session) {
      throw createFault({
        category: 'inference',
        code: 'INFER_SESSION_UNKNOWN',
        origin: 'runtime-core',
        severity: 'error',
        recoverable: false,
        message: 'inference session missing',
      });
    }
    if (session.cancelled) {
      return { done: true, stopReason: 'cancelled' as const };
    }
    const token = session.tokens[session.index];
    if (token === undefined) {
      return { done: true, stopReason: 'completed' as const };
    }
    session.index += 1;
    return { done: false, token };
  }

  async generateAll(requestId: string, maxTokens: number) {
    const session = this.#sessions.get(requestId);
    if (!session) {
      throw createFault({
        category: 'inference',
        code: 'INFER_SESSION_UNKNOWN',
        origin: 'runtime-core',
        severity: 'error',
        recoverable: false,
        message: 'inference session missing',
      });
    }
    if (session.cancelled) {
      return { text: '', tokenCount: 0, done: true };
    }
    const cap = Number.isFinite(maxTokens) ? maxTokens : session.tokens.length;
    const slice = session.tokens.slice(session.index, session.index + cap);
    session.index += slice.length;
    return {
      text: slice.join(' '),
      tokenCount: slice.length,
      done: session.index >= session.tokens.length,
    };
  }

  async cancelInference(requestId: string): Promise<void> {
    const session = this.#sessions.get(requestId);
    if (session) {
      session.cancelled = true;
    }
  }

  getMemorySnapshot() {
    const usedBytes = this.#chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    return { usedBytes, limitBytes: this.#options.memoryLimitBytes ?? null };
  }

  async destroy(): Promise<void> {
    this.#sessions.clear();
    this.#chunks = [];
  }
}
