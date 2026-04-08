import type {
  BulkInferenceResult,
  InferenceRequest,
  InferenceSummary,
  ModelLoadSessionOptions,
  ModelLoadSummary,
  SerializableFault,
  StructuredLogEvent,
  TokenChunk,
} from '@wasml-llama/runtime-core';

export const WORKER_PROTOCOL_VERSION = 1 as const;

export type WorkerState = 'INIT' | 'LOADING' | 'READY' | 'RUNNING' | 'ERROR' | 'TERMINATED';

interface BaseCommand<TType extends string, TPayload> {
  version: typeof WORKER_PROTOCOL_VERSION;
  type: TType;
  requestId: string;
  payload: TPayload;
}

interface BaseEvent<TType extends string, TPayload> {
  version: typeof WORKER_PROTOCOL_VERSION;
  type: TType;
  requestId: string;
  payload: TPayload;
}

export type InitializeCommand = BaseCommand<'initialize', { buildId: string; abiVersion: string }>;
export type LoadModelBeginCommand = BaseCommand<'load-model-begin', ModelLoadSessionOptions>;
export type LoadModelChunkCommand = BaseCommand<'load-model-chunk', { chunkIndex: number; chunk: ArrayBuffer; isFinal: boolean }>;
export type LoadModelChunkBatchCommand = BaseCommand<'load-model-chunk-batch', { startChunkIndex: number; chunks: ArrayBuffer[]; isFinal: boolean }>;
export type LoadModelCommitCommand = BaseCommand<'load-model-commit', Record<string, never>>;
export type RunInferenceCommand = BaseCommand<'run-inference', Omit<InferenceRequest, 'requestId'>>;
export type CancelInferenceCommand = BaseCommand<'cancel-inference', { targetRequestId: string }>;
export type DestroyCommand = BaseCommand<'destroy', Record<string, never>>;

export type WorkerCommand =
  | InitializeCommand
  | LoadModelBeginCommand
  | LoadModelChunkCommand
  | LoadModelChunkBatchCommand
  | LoadModelCommitCommand
  | RunInferenceCommand
  | CancelInferenceCommand
  | DestroyCommand;

export type AckEvent = BaseEvent<'ack', { commandType: WorkerCommand['type']; details?: Record<string, unknown> }>;
export type StateEvent = BaseEvent<'state', { from: WorkerState; to: WorkerState }>;
export type LogEvent = BaseEvent<'log', StructuredLogEvent>;
export type ModelReadyEvent = BaseEvent<'result', { commandType: 'load-model-commit'; summary: ModelLoadSummary }>;
export type InferenceReadyEvent = BaseEvent<'result', { commandType: 'run-inference'; summary: InferenceSummary | BulkInferenceResult }>;
export type InitializeReadyEvent = BaseEvent<'result', { commandType: 'initialize'; summary: { state: WorkerState } }>;
export type DestroyReadyEvent = BaseEvent<'result', { commandType: 'destroy'; summary: { state: WorkerState } }>;
export type TokenEvent = BaseEvent<'token', TokenChunk>;
export type ErrorEvent = BaseEvent<'error', { fault: SerializableFault }>;

export type WorkerEvent =
  | AckEvent
  | StateEvent
  | LogEvent
  | ModelReadyEvent
  | InferenceReadyEvent
  | InitializeReadyEvent
  | DestroyReadyEvent
  | TokenEvent
  | ErrorEvent;
