import {
  createFault,
  normalizeFault,
  type CoreRuntime,
  type EventSink,
  type SerializableFault,
} from '@wasml-llama/runtime-core';
import {
  WORKER_PROTOCOL_VERSION,
  type RunInferenceCommand,
  type WorkerCommand,
  type WorkerEvent,
  type WorkerState,
} from '../protocol/v1.js';
import { planRecovery } from '../recovery/policy.js';
import { transitionWorkerState } from '../state/worker-state.js';

export interface WorkerRuntimeControllerOptions {
  createCoreRuntime: (eventSink: EventSink) => CoreRuntime;
  emit: (event: WorkerEvent) => void;
  maxModelLoadAttempts?: number;
}

interface LoadSession {
  options: { totalBytes?: number; expectedChunks?: number };
  chunks: Uint8Array[];
  nextChunkIndex: number;
  bytesReceived: number;
  sawFinalChunk: boolean;
}

export class WorkerRuntimeController {
  #state: WorkerState = 'INIT';
  #core: CoreRuntime | undefined;
  #loadSession: LoadSession | undefined;
  #activeInferenceId: string | null = null;
  readonly #createCoreRuntime: WorkerRuntimeControllerOptions['createCoreRuntime'];
  readonly #emit: WorkerRuntimeControllerOptions['emit'];
  readonly #maxModelLoadAttempts: number;

  constructor(options: WorkerRuntimeControllerOptions) {
    this.#createCoreRuntime = options.createCoreRuntime;
    this.#emit = options.emit;
    this.#maxModelLoadAttempts = options.maxModelLoadAttempts ?? 2;
  }

  get state(): WorkerState {
    return this.#state;
  }

  async dispatch(command: WorkerCommand): Promise<void> {
    if (command.version !== WORKER_PROTOCOL_VERSION) {
      this.#emitError(command.requestId, createFault({
        category: 'protocol',
        code: 'PROTO_VERSION_UNSUPPORTED',
        origin: 'runtime-worker',
        severity: 'error',
        recoverable: false,
        message: 'protocol version unsupported',
        context: { version: command.version },
      }));
      return;
    }

    try {
      switch (command.type) {
        case 'initialize':
          await this.#handleInitialize(command.requestId);
          break;
        case 'load-model-begin':
          await this.#handleLoadModelBegin(command.requestId, command.payload);
          break;
        case 'load-model-chunk':
          await this.#handleLoadModelChunk(
            command.requestId,
            command.payload.chunkIndex,
            [command.payload.chunk],
            command.payload.isFinal,
            'load-model-chunk',
          );
          break;
        case 'load-model-chunk-batch':
          await this.#handleLoadModelChunk(
            command.requestId,
            command.payload.startChunkIndex,
            command.payload.chunks,
            command.payload.isFinal,
            'load-model-chunk-batch',
          );
          break;
        case 'load-model-commit':
          await this.#handleLoadModelCommit(command.requestId);
          break;
        case 'run-inference':
          await this.#handleRunInference(command.requestId, command);
          break;
        case 'cancel-inference':
          await this.#handleCancelInference(command.requestId, command.payload.targetRequestId);
          break;
        case 'destroy':
          await this.#handleDestroy(command.requestId);
          break;
      }
    } catch (error) {
      const fault = normalizeFault(error, {
        category: 'inference',
        code: 'INFER_WORKER_HANDLER_FAILED',
        origin: 'runtime-worker',
        severity: 'error',
        recoverable: false,
      });
      if (fault.category !== 'protocol' && this.#state !== 'TERMINATED') {
        this.#transition(command.requestId, 'fault');
      }
      if (command.type === 'run-inference') {
        this.#activeInferenceId = null;
      }
      this.#emitError(command.requestId, fault);
    }
  }

  async #handleInitialize(requestId: string): Promise<void> {
    await this.#ensureCoreRuntime();
    this.#emitAck(requestId, 'initialize', { state: this.#state });
    this.#emit({
      version: WORKER_PROTOCOL_VERSION,
      type: 'result',
      requestId,
      payload: {
        commandType: 'initialize',
        summary: { state: this.#state },
      },
    });
  }

  async #handleLoadModelBegin(requestId: string, options: LoadSession['options']): Promise<void> {
    await this.#ensureCoreRuntime();
    this.#transition(requestId, 'begin-load');
    this.#loadSession = { options, chunks: [], nextChunkIndex: 0, bytesReceived: 0, sawFinalChunk: false };
    await this.#core?.beginModelLoad(options);
    this.#emitAck(requestId, 'load-model-begin');
  }

  async #handleLoadModelChunk(
    requestId: string,
    startChunkIndex: number,
    chunkBuffers: ArrayBuffer[],
    isFinal: boolean,
    commandType: 'load-model-chunk' | 'load-model-chunk-batch',
  ): Promise<void> {
    if (this.#state !== 'LOADING' || !this.#loadSession || !this.#core) {
      throw createFault({
        category: 'protocol',
        code: 'PROTO_MODEL_CHUNK_OUT_OF_SEQUENCE',
        origin: 'runtime-worker',
        severity: 'error',
        recoverable: false,
        message: 'model chunk arrived out of sequence',
      });
    }

    if (startChunkIndex !== this.#loadSession.nextChunkIndex) {
      throw createFault({
        category: 'protocol',
        code: 'PROTO_MODEL_CHUNK_INDEX_MISMATCH',
        origin: 'runtime-worker',
        severity: 'error',
        recoverable: false,
        message: 'model chunks arrived out of order',
        context: { expectedChunkIndex: this.#loadSession.nextChunkIndex, receivedChunkIndex: startChunkIndex },
      });
    }
    if (this.#loadSession.sawFinalChunk) {
      throw createFault({
        category: 'protocol',
        code: 'PROTO_MODEL_CHUNK_AFTER_FINAL',
        origin: 'runtime-worker',
        severity: 'error',
        recoverable: false,
        message: 'received model chunk after final chunk',
      });
    }
    if (chunkBuffers.length === 0) {
      throw createFault({
        category: 'protocol',
        code: 'PROTO_MODEL_CHUNK_BATCH_EMPTY',
        origin: 'runtime-worker',
        severity: 'error',
        recoverable: false,
        message: 'received empty model chunk batch',
      });
    }

    for (const buffer of chunkBuffers) {
      const chunk = new Uint8Array(buffer);
      this.#loadSession.chunks.push(chunk.slice());
      this.#loadSession.bytesReceived += chunk.byteLength;
      this.#loadSession.nextChunkIndex += 1;
      if (this.#loadSession.options.totalBytes !== undefined && this.#loadSession.bytesReceived > this.#loadSession.options.totalBytes) {
        throw createFault({
          category: 'model',
          code: 'MODEL_LOAD_BYTES_EXCEEDED',
          origin: 'runtime-worker',
          severity: 'error',
          recoverable: false,
          message: 'model load exceeded declared byte size',
          context: { bytesReceived: this.#loadSession.bytesReceived, totalBytes: this.#loadSession.options.totalBytes },
        });
      }
      await this.#core.appendModelChunk(chunk);
    }

    if (isFinal) {
      this.#loadSession.sawFinalChunk = true;
      if (this.#loadSession.options.expectedChunks !== undefined &&
          this.#loadSession.nextChunkIndex !== this.#loadSession.options.expectedChunks) {
        throw createFault({
          category: 'model',
          code: 'MODEL_LOAD_FINAL_CHUNK_COUNT_MISMATCH',
          origin: 'runtime-worker',
          severity: 'error',
          recoverable: false,
          message: 'final model chunk count did not match expected chunk count',
          context: { chunkCount: this.#loadSession.nextChunkIndex, expectedChunks: this.#loadSession.options.expectedChunks },
        });
      }
    }

    this.#emitAck(requestId, commandType, {
      chunkCount: chunkBuffers.length,
      nextChunkIndex: this.#loadSession.nextChunkIndex,
      bytesReceived: this.#loadSession.bytesReceived,
    });
  }

  async #handleLoadModelCommit(requestId: string): Promise<void> {
    if (this.#state !== 'LOADING' || !this.#loadSession || !this.#core) {
      throw createFault({
        category: 'protocol',
        code: 'PROTO_MODEL_COMMIT_OUT_OF_SEQUENCE',
        origin: 'runtime-worker',
        severity: 'error',
        recoverable: false,
        message: 'model commit arrived out of sequence',
      });
    }

    if (!this.#loadSession.sawFinalChunk) {
      throw createFault({
        category: 'model',
        code: 'MODEL_LOAD_FINAL_CHUNK_MISSING',
        origin: 'runtime-worker',
        severity: 'error',
        recoverable: false,
        message: 'model commit arrived before the final chunk',
      });
    }
    if (this.#loadSession.options.totalBytes !== undefined &&
        this.#loadSession.bytesReceived !== this.#loadSession.options.totalBytes) {
      throw createFault({
        category: 'model',
        code: 'MODEL_LOAD_TOTAL_BYTES_MISMATCH',
        origin: 'runtime-worker',
        severity: 'error',
        recoverable: false,
        message: 'received model bytes did not match declared total',
        context: { bytesReceived: this.#loadSession.bytesReceived, totalBytes: this.#loadSession.options.totalBytes },
      });
    }
    if (this.#loadSession.options.expectedChunks !== undefined &&
        this.#loadSession.nextChunkIndex !== this.#loadSession.options.expectedChunks) {
      throw createFault({
        category: 'model',
        code: 'MODEL_LOAD_CHUNK_COUNT_MISMATCH',
        origin: 'runtime-worker',
        severity: 'error',
        recoverable: false,
        message: 'received model chunk count did not match expected count',
        context: { chunkCount: this.#loadSession.nextChunkIndex, expectedChunks: this.#loadSession.options.expectedChunks },
      });
    }

    let attempt = 0;
    while (attempt < this.#maxModelLoadAttempts) {
      attempt += 1;
      try {
        const summary = await this.#core.commitModelLoad();
        this.#transition(requestId, 'load-ready');
        this.#emit({
          version: WORKER_PROTOCOL_VERSION,
          type: 'result',
          requestId,
          payload: {
            commandType: 'load-model-commit',
            summary,
          },
        });
        this.#loadSession = undefined;
        return;
      } catch (error) {
        const fault = normalizeFault(error, {
          category: 'model',
          code: 'MODEL_LOAD_COMMIT_FAILED',
          origin: 'runtime-worker',
          severity: 'error',
          recoverable: attempt < this.#maxModelLoadAttempts,
        });
        const recovery = planRecovery(fault.toJSON());
        if (!fault.recoverable || recovery.action !== 'retry-model-load' || attempt >= this.#maxModelLoadAttempts) {
          throw fault;
        }
        this.#emit({
          version: WORKER_PROTOCOL_VERSION,
          type: 'log',
          requestId,
          payload: {
            timestamp: new Date().toISOString(),
            origin: 'runtime-worker',
            severity: 'warn',
            code: 'MODEL_RETRY_SCHEDULED',
            message: 'retrying model load',
            requestId,
            context: { attempt, delayMs: recovery.delayMs },
          },
        });
        await sleep(recovery.delayMs);
          await this.#replaceRuntime();
        const loadSession = this.#loadSession;
        const core = this.#core;
        if (!loadSession || !core) {
          throw fault;
        }
        await core.beginModelLoad(loadSession.options);
        for (const chunk of loadSession.chunks) {
          await core.appendModelChunk(chunk);
        }
      }
    }
  }

  async #handleRunInference(requestId: string, command: RunInferenceCommand): Promise<void> {
    if (this.#state !== 'READY' || !this.#core) {
      throw createFault({
        category: 'protocol',
        code: 'PROTO_INFERENCE_NOT_READY',
        origin: 'runtime-worker',
        severity: 'error',
        recoverable: false,
        message: 'worker not ready for inference',
      });
    }
    if (this.#activeInferenceId) {
      throw createFault({
        category: 'protocol',
        code: 'PROTO_CONCURRENT_INFERENCE_REJECTED',
        origin: 'runtime-worker',
        severity: 'error',
        recoverable: false,
        message: 'worker already running inference',
      });
    }
    this.#activeInferenceId = requestId;
    this.#transition(requestId, 'start-inference');
    this.#emitAck(requestId, 'run-inference');
    if (command.payload.mode === 'bulk') {
      const summary = await this.#core.runInferenceBulk({ ...command.payload, requestId });
      this.#transition(requestId, 'finish-inference');
      this.#activeInferenceId = null;
      this.#emit({
        version: WORKER_PROTOCOL_VERSION,
        type: 'result',
        requestId,
        payload: {
          commandType: 'run-inference',
          summary,
        },
      });
      return;
    }
    const iterator = this.#core.runInference({ ...command.payload, requestId })[Symbol.asyncIterator]();
    while (true) {
      const step = await iterator.next();
      if (step.done) {
        this.#transition(requestId, 'finish-inference');
        this.#activeInferenceId = null;
        this.#emit({
          version: WORKER_PROTOCOL_VERSION,
          type: 'result',
          requestId,
          payload: {
            commandType: 'run-inference',
            summary: step.value,
          },
        });
        return;
      }
      this.#emit({
        version: WORKER_PROTOCOL_VERSION,
        type: 'token',
        requestId,
        payload: step.value,
      });
    }
  }

  async #handleCancelInference(requestId: string, targetRequestId: string): Promise<void> {
    if (!this.#core || this.#activeInferenceId !== targetRequestId) {
      throw createFault({
        category: 'protocol',
        code: 'PROTO_CANCEL_TARGET_UNKNOWN',
        origin: 'runtime-worker',
        severity: 'error',
        recoverable: false,
        message: 'cancel target unknown',
        context: { targetRequestId },
      });
    }
    await this.#core.cancelInference(targetRequestId);
    this.#emitAck(requestId, 'cancel-inference');
  }

  async #handleDestroy(requestId: string): Promise<void> {
    if (this.#state !== 'TERMINATED') {
      this.#transition(requestId, 'destroy');
    }
    await this.#core?.destroy();
    this.#core = undefined;
    this.#activeInferenceId = null;
    this.#emit({
      version: WORKER_PROTOCOL_VERSION,
      type: 'result',
      requestId,
      payload: {
        commandType: 'destroy',
        summary: { state: this.#state },
      },
    });
  }

  async #ensureCoreRuntime(): Promise<void> {
    if (!this.#core) {
      this.#core = this.#createCoreRuntime((event) => {
        this.#emit({
          version: WORKER_PROTOCOL_VERSION,
          type: 'log',
          requestId: event.requestId ?? 'system',
          payload: event,
        });
      });
      await this.#core.initialize();
    }
  }

  async #replaceRuntime(): Promise<void> {
    await this.#core?.destroy();
    this.#core = undefined;
    await this.#ensureCoreRuntime();
  }

  #transition(requestId: string, event: Parameters<typeof transitionWorkerState>[1]): void {
    const from = this.#state;
    const to = transitionWorkerState(this.#state, event);
    this.#state = to;
    this.#emit({
      version: WORKER_PROTOCOL_VERSION,
      type: 'state',
      requestId,
      payload: { from, to },
    });
  }

  #emitAck(requestId: string, commandType: WorkerCommand['type'], details?: Record<string, unknown>): void {
    this.#emit({
      version: WORKER_PROTOCOL_VERSION,
      type: 'ack',
      requestId,
      payload: details ? { commandType, details } : { commandType },
    });
  }

  #emitError(requestId: string, fault: { toJSON(): SerializableFault }): void {
    this.#emit({
      version: WORKER_PROTOCOL_VERSION,
      type: 'error',
      requestId,
      payload: { fault: fault.toJSON() },
    });
  }
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
