import {
  type BulkInferenceResult,
  type InferenceRequest,
  type InferenceSummary,
  type ModelLoadSessionOptions,
  type ModelLoadSummary,
  type TokenChunk,
  type WasmAdapter,
} from './adapter.js';
import { createLogEvent, type EventSink } from './events.js';
import { createFault, normalizeFault, type SerializableFault } from './errors.js';

export interface RuntimeCoreVersionInfo {
  abiVersion: string;
  buildId: string;
}

export interface CoreRuntime {
  initialize(): Promise<void>;
  beginModelLoad(options: ModelLoadSessionOptions): Promise<void>;
  appendModelChunk(chunk: Uint8Array): Promise<void>;
  commitModelLoad(): Promise<ModelLoadSummary>;
  runInference(request: Omit<InferenceRequest, 'requestId'> & { requestId?: string }): AsyncGenerator<TokenChunk, InferenceSummary>;
  runInferenceBulk(request: Omit<InferenceRequest, 'requestId'> & { requestId?: string }): Promise<BulkInferenceResult>;
  cancelInference(requestId: string): Promise<void>;
  destroy(): Promise<void>;
  getLastFault(): SerializableFault | null;
}

export interface CreateCoreRuntimeOptions {
  adapter: WasmAdapter;
  versions: RuntimeCoreVersionInfo;
  eventSink?: EventSink;
}

function generateRequestId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  return random ?? `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export class WasmCoreRuntime implements CoreRuntime {
  readonly #adapter: WasmAdapter;
  readonly #versions: RuntimeCoreVersionInfo;
  readonly #eventSink: EventSink | undefined;
  #initialized = false;
  #loading = false;
  #modelLoaded = false;
  #destroyed = false;
  #lastFault: SerializableFault | null = null;

  constructor(options: CreateCoreRuntimeOptions) {
    this.#adapter = options.adapter;
    this.#versions = options.versions;
    this.#eventSink = options.eventSink;
  }

  async initialize(): Promise<void> {
    if (this.#destroyed) {
      throw createFault({
        category: 'initialization',
        code: 'INIT_RUNTIME_DESTROYED',
        origin: 'runtime-core',
        severity: 'fatal',
        recoverable: false,
        message: 'runtime destroyed',
      });
    }
    if (this.#initialized) {
      return;
    }
    try {
      await this.#adapter.initialize(this.#emit.bind(this));
      this.#initialized = true;
      this.#emit(createLogEvent({
        origin: 'runtime-core',
        severity: 'info',
        code: 'INIT_READY',
        message: 'core runtime initialized',
        context: { ...this.#versions },
      }));
    } catch (error) {
      throw this.#recordFault(normalizeFault(error, {
        category: 'initialization',
        code: 'INIT_WASM_UNAVAILABLE',
        origin: 'runtime-core',
        severity: 'fatal',
        recoverable: false,
      }));
    }
  }

  async beginModelLoad(options: ModelLoadSessionOptions): Promise<void> {
    this.#assertReadyForModelLoad();
    try {
      await this.#adapter.beginModelLoad(options);
      this.#loading = true;
      this.#modelLoaded = false;
      this.#emit(createLogEvent({
        origin: 'runtime-core',
        severity: 'info',
        code: 'MODEL_LOAD_BEGIN',
        message: 'model load started',
        context: { ...options },
      }));
    } catch (error) {
      throw this.#recordFault(normalizeFault(error, {
        category: 'model',
        code: 'MODEL_LOAD_BEGIN_FAILED',
        origin: 'runtime-core',
        severity: 'error',
        recoverable: true,
      }));
    }
  }

  async appendModelChunk(chunk: Uint8Array): Promise<void> {
    if (!this.#loading) {
      throw createFault({
        category: 'protocol',
        code: 'PROTO_MODEL_LOAD_NOT_STARTED',
        origin: 'runtime-core',
        severity: 'error',
        recoverable: false,
        message: 'model load has not started',
      });
    }
    try {
      await this.#adapter.writeModelChunk(chunk);
    } catch (error) {
      throw this.#recordFault(normalizeFault(error, {
        category: 'model',
        code: 'MODEL_CHUNK_WRITE_FAILED',
        origin: 'runtime-core',
        severity: 'error',
        recoverable: true,
      }));
    }
  }

  async commitModelLoad(): Promise<ModelLoadSummary> {
    if (!this.#loading) {
      throw createFault({
        category: 'protocol',
        code: 'PROTO_MODEL_LOAD_NOT_STARTED',
        origin: 'runtime-core',
        severity: 'error',
        recoverable: false,
        message: 'model load has not started',
      });
    }
    try {
      const summary = await this.#adapter.finalizeModelLoad();
      this.#loading = false;
      this.#modelLoaded = true;
      this.#emit(createLogEvent({
        origin: 'runtime-core',
        severity: 'info',
        code: 'MODEL_LOAD_READY',
        message: 'model load committed',
        context: { ...summary },
      }));
      return summary;
    } catch (error) {
      this.#loading = false;
      throw this.#recordFault(normalizeFault(error, {
        category: 'model',
        code: 'MODEL_FINALIZE_FAILED',
        origin: 'runtime-core',
        severity: 'error',
        recoverable: true,
      }));
    }
  }

  async *runInference(request: Omit<InferenceRequest, 'requestId'> & { requestId?: string }): AsyncGenerator<TokenChunk, InferenceSummary> {
    this.#assertReadyForInference();

    const requestId = request.requestId ?? generateRequestId();
    const maxTokens = request.maxTokens ?? 256;
    const batchSize = request.streamBatchSize ?? 8;
    let tokenIndex = 0;

    try {
      await this.#adapter.beginInference({ ...request, requestId });
      while (tokenIndex < maxTokens) {
        if (request.signal?.aborted) {
          await this.#adapter.cancelInference(requestId);
        }
        const step = await this.#adapter.stepInference(requestId, Math.min(batchSize, maxTokens - tokenIndex));
        if (step.token !== undefined) {
          yield {
            requestId,
            token: step.token,
            tokenIndex,
            isSpecial: step.isSpecial ?? false,
          };
          tokenIndex += step.tokenCount ?? 1;
        }
        if (step.done) {
          return {
            requestId,
            generatedTokens: tokenIndex,
            stopReason: step.stopReason ?? 'completed',
          };
        }
      }
      await this.#adapter.cancelInference(requestId);
      return {
        requestId,
        generatedTokens: tokenIndex,
        stopReason: 'cancelled',
      };
    } catch (error) {
      throw this.#recordFault(normalizeFault(error, {
        category: 'inference',
        code: 'INFER_EXECUTION_FAILED',
        origin: 'runtime-core',
        severity: 'error',
        recoverable: false,
      }));
    }
  }

  async runInferenceBulk(request: Omit<InferenceRequest, 'requestId'> & { requestId?: string }): Promise<BulkInferenceResult> {
    this.#assertReadyForInference();

    const requestId = request.requestId ?? generateRequestId();
    const maxTokens = request.maxTokens ?? Number.POSITIVE_INFINITY;

    try {
      await this.#adapter.beginInference({ ...request, requestId, mode: 'bulk' });
      if (request.signal?.aborted) {
        await this.#adapter.cancelInference(requestId);
        return {
          requestId,
          generatedTokens: 0,
          stopReason: 'cancelled',
          text: '',
        };
      }
      const result = await this.#adapter.generateAll(requestId, maxTokens);
      return {
        requestId,
        generatedTokens: result.tokenCount,
        stopReason: 'completed',
        text: result.text,
      };
    } catch (error) {
      throw this.#recordFault(normalizeFault(error, {
        category: 'inference',
        code: 'INFER_BULK_EXECUTION_FAILED',
        origin: 'runtime-core',
        severity: 'error',
        recoverable: false,
      }));
    }
  }

  async cancelInference(requestId: string): Promise<void> {
    try {
      await this.#adapter.cancelInference(requestId);
    } catch (error) {
      throw this.#recordFault(normalizeFault(error, {
        category: 'inference',
        code: 'INFER_CANCEL_FAILED',
        origin: 'runtime-core',
        severity: 'error',
        recoverable: false,
      }));
    }
  }

  async destroy(): Promise<void> {
    if (this.#destroyed) {
      return;
    }
    await this.#adapter.destroy();
    this.#destroyed = true;
    this.#initialized = false;
    this.#loading = false;
    this.#modelLoaded = false;
  }

  getLastFault(): SerializableFault | null {
    return this.#lastFault;
  }

  #assertReadyForModelLoad(): void {
    if (!this.#initialized) {
      throw createFault({
        category: 'initialization',
        code: 'INIT_RUNTIME_NOT_READY',
        origin: 'runtime-core',
        severity: 'error',
        recoverable: false,
        message: 'runtime not initialized',
      });
    }
    if (this.#destroyed) {
      throw createFault({
        category: 'initialization',
        code: 'INIT_RUNTIME_DESTROYED',
        origin: 'runtime-core',
        severity: 'fatal',
        recoverable: false,
        message: 'runtime destroyed',
      });
    }
  }

  #assertReadyForInference(): void {
    if (!this.#initialized || !this.#modelLoaded) {
      throw createFault({
        category: 'initialization',
        code: 'INIT_MODEL_NOT_READY',
        origin: 'runtime-core',
        severity: 'error',
        recoverable: false,
        message: 'model not loaded',
      });
    }
  }

  #recordFault(fault: ReturnType<typeof normalizeFault>): ReturnType<typeof normalizeFault> {
    this.#lastFault = fault.toJSON();
    this.#emit(createLogEvent({
      origin: fault.origin,
      severity: fault.severity,
      code: fault.code,
      message: fault.message,
      context: fault.context,
    }));
    return fault;
  }

  #emit(event: ReturnType<typeof createLogEvent>): void {
    this.#eventSink?.(event);
  }
}

export function createCoreRuntime(options: CreateCoreRuntimeOptions): CoreRuntime {
  return new WasmCoreRuntime(options);
}
