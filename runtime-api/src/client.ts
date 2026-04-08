import type { BulkInferenceResult, InferenceSummary, ModelLoadSummary, TokenChunk } from '@wasml-llama/runtime-core';
import { WasmlLlamaError } from '@wasml-llama/runtime-core';
import { WORKER_PROTOCOL_VERSION, type WorkerCommand, type WorkerEvent } from '@wasml-llama/runtime-worker';
import { AsyncQueue } from './async-queue.js';

export interface WorkerLike {
  postMessage(message: WorkerCommand, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerEvent>) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent<WorkerEvent>) => void): void;
  terminate?: () => void;
}

export type ModelInput = ArrayBuffer | Uint8Array | AsyncIterable<Uint8Array>;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

interface ActiveInference {
  queue: AsyncQueue<TokenChunk>;
  result: Deferred<InferenceSummary>;
}

export interface RuntimeClient {
  initialize(): Promise<void>;
  loadModel(source: ModelInput): Promise<ModelLoadSummary>;
  runInference(input: { prompt: string; maxTokens?: number; signal?: AbortSignal }): AsyncGenerator<TokenChunk, InferenceSummary>;
  runInferenceBulk(input: { prompt: string; maxTokens?: number; signal?: AbortSignal }): Promise<BulkInferenceResult>;
  cancelInference(requestId: string): Promise<void>;
  destroy(): Promise<void>;
}

const MODEL_CHUNK_BYTES = 256 * 1024;
const MODEL_CHUNKS_PER_BATCH = 8;

export interface WorkerRuntimeClientOptions {
  createWorker: () => WorkerLike;
  buildId?: string;
  abiVersion?: string;
}

export class WorkerRuntimeClient implements RuntimeClient {
  readonly #createWorker: WorkerRuntimeClientOptions['createWorker'];
  readonly #buildId: string;
  readonly #abiVersion: string;
  #worker: WorkerLike | undefined;
  #listener: ((event: MessageEvent<WorkerEvent>) => void) | undefined;
  readonly #acks = new Map<string, Deferred<void>>();
  readonly #results = new Map<string, Deferred<unknown>>();
  readonly #activeInferences = new Map<string, ActiveInference>();
  #initialized = false;

  constructor(options: WorkerRuntimeClientOptions) {
    this.#createWorker = options.createWorker;
    this.#buildId = options.buildId ?? 'dev';
    this.#abiVersion = options.abiVersion ?? '0.1.0';
  }

  async initialize(): Promise<void> {
    if (this.#initialized) {
      return;
    }
    this.#ensureWorker();
    const requestId = createRequestId();
    const result = this.#defer<{ state: string }>();
    this.#results.set(requestId, result as Deferred<unknown>);
    this.#post({
      version: WORKER_PROTOCOL_VERSION,
      type: 'initialize',
      requestId,
      payload: { buildId: this.#buildId, abiVersion: this.#abiVersion },
    });
    await result.promise;
    this.#initialized = true;
  }

  async loadModel(source: ModelInput): Promise<ModelLoadSummary> {
    await this.initialize();
    const bytes = await materializeModel(source);
    const beginId = createRequestId();
    const beginAck = this.#defer<void>();
    this.#acks.set(beginId, beginAck);
    this.#post({
      version: WORKER_PROTOCOL_VERSION,
      type: 'load-model-begin',
      requestId: beginId,
      payload: {
        totalBytes: bytes.byteLength,
        expectedChunks: Math.ceil(bytes.byteLength / MODEL_CHUNK_BYTES),
      },
    });
    await beginAck.promise;

    const totalChunks = Math.ceil(bytes.byteLength / MODEL_CHUNK_BYTES);
    for (let startChunkIndex = 0; startChunkIndex < totalChunks; startChunkIndex += MODEL_CHUNKS_PER_BATCH) {
      const requestId = createRequestId();
      const ack = this.#defer<void>();
      this.#acks.set(requestId, ack);
      const buffers: ArrayBuffer[] = [];
      const endChunkIndex = Math.min(startChunkIndex + MODEL_CHUNKS_PER_BATCH, totalChunks);
      for (let chunkIndex = startChunkIndex; chunkIndex < endChunkIndex; chunkIndex += 1) {
        const offset = chunkIndex * MODEL_CHUNK_BYTES;
        const chunk = bytes.slice(offset, offset + MODEL_CHUNK_BYTES);
        buffers.push(chunk.buffer);
      }
      this.#post({
        version: WORKER_PROTOCOL_VERSION,
        type: 'load-model-chunk-batch',
        requestId,
        payload: {
          startChunkIndex,
          chunks: buffers,
          isFinal: endChunkIndex >= totalChunks,
        },
      }, buffers);
      await ack.promise;
    }

    const commitId = createRequestId();
    const result = this.#defer<ModelLoadSummary>();
    this.#results.set(commitId, result as Deferred<unknown>);
    this.#post({
      version: WORKER_PROTOCOL_VERSION,
      type: 'load-model-commit',
      requestId: commitId,
      payload: {},
    });
    return result.promise;
  }

  async *runInference(input: { prompt: string; maxTokens?: number; signal?: AbortSignal }): AsyncGenerator<TokenChunk, InferenceSummary> {
    await this.initialize();
    const requestId = createRequestId();
    const { signal, ...payload } = input;
    const ack = this.#defer<void>();
    const result = this.#defer<InferenceSummary>();
    const queue = new AsyncQueue<TokenChunk>();
    this.#acks.set(requestId, ack);
    this.#results.set(requestId, result as Deferred<unknown>);
    this.#activeInferences.set(requestId, { queue, result });
    this.#post({
      version: WORKER_PROTOCOL_VERSION,
      type: 'run-inference',
      requestId,
      payload,
    });
    await ack.promise;

    if (signal) {
      signal.addEventListener('abort', () => {
        void this.cancelInference(requestId);
      }, { once: true });
    }

    for await (const token of queue) {
      yield token;
    }
    return result.promise;
  }

  async runInferenceBulk(input: { prompt: string; maxTokens?: number; signal?: AbortSignal }): Promise<BulkInferenceResult> {
    await this.initialize();
    const requestId = createRequestId();
    const { signal, ...payload } = input;
    const ack = this.#defer<void>();
    const result = this.#defer<BulkInferenceResult>();
    this.#acks.set(requestId, ack);
    this.#results.set(requestId, result as Deferred<unknown>);
    this.#post({
      version: WORKER_PROTOCOL_VERSION,
      type: 'run-inference',
      requestId,
      payload: { ...payload, mode: 'bulk' },
    });
    await ack.promise;

    if (signal) {
      signal.addEventListener('abort', () => {
        void this.cancelInference(requestId);
      }, { once: true });
    }

    return result.promise;
  }

  async cancelInference(requestId: string): Promise<void> {
    const cancelId = createRequestId();
    const ack = this.#defer<void>();
    this.#acks.set(cancelId, ack);
    this.#post({
      version: WORKER_PROTOCOL_VERSION,
      type: 'cancel-inference',
      requestId: cancelId,
      payload: { targetRequestId: requestId },
    });
    await ack.promise;
  }

  async destroy(): Promise<void> {
    if (!this.#worker) {
      return;
    }
    const requestId = createRequestId();
    const result = this.#defer<{ state: string }>();
    this.#results.set(requestId, result as Deferred<unknown>);
    this.#post({
      version: WORKER_PROTOCOL_VERSION,
      type: 'destroy',
      requestId,
      payload: {},
    });
    await result.promise;
    if (this.#listener) {
      this.#worker.removeEventListener('message', this.#listener);
    }
    this.#worker.terminate?.();
    this.#worker = undefined;
    this.#listener = undefined;
    this.#initialized = false;
  }

  #ensureWorker(): void {
    if (this.#worker) {
      return;
    }
    this.#worker = this.#createWorker();
    this.#listener = (event) => {
      this.#handleEvent(event.data);
    };
    this.#worker.addEventListener('message', this.#listener);
  }

  #post(command: WorkerCommand, transfer: Transferable[] = []): void {
    this.#ensureWorker();
    this.#worker?.postMessage(command, transfer);
  }

  #handleEvent(event: WorkerEvent): void {
    if (event.type === 'ack') {
      this.#acks.get(event.requestId)?.resolve();
      this.#acks.delete(event.requestId);
      return;
    }
    if (event.type === 'token') {
      this.#activeInferences.get(event.requestId)?.queue.push(event.payload);
      return;
    }
    if (event.type === 'result') {
      const deferred = this.#results.get(event.requestId);
      if (event.payload.commandType === 'run-inference') {
        const active = this.#activeInferences.get(event.requestId);
        active?.queue.close();
        active?.result.resolve(event.payload.summary);
        this.#activeInferences.delete(event.requestId);
      }
      deferred?.resolve(event.payload.summary as never);
      this.#results.delete(event.requestId);
      return;
    }
    if (event.type === 'error') {
      const fault = new WasmlLlamaError(event.payload.fault);
      this.#acks.get(event.requestId)?.reject(fault);
      this.#acks.delete(event.requestId);
      this.#results.get(event.requestId)?.reject(fault);
      this.#results.delete(event.requestId);
      const active = this.#activeInferences.get(event.requestId);
      active?.queue.fail(fault);
      active?.result.reject(fault);
      this.#activeInferences.delete(event.requestId);
    }
  }

  #defer<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }
}

async function materializeModel(source: ModelInput): Promise<Uint8Array> {
  if (source instanceof Uint8Array) {
    return source;
  }
  if (source instanceof ArrayBuffer) {
    return new Uint8Array(source.slice(0));
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of source) {
    chunks.push(chunk);
    total += chunk.byteLength;
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function createRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
