import { createCoreRuntime } from '@wasml-llama/runtime-core';
import type { WasmAdapter } from '@wasml-llama/runtime-core';
import { WorkerRuntimeController } from './handlers/worker-runtime.js';
import type { WorkerCommand, WorkerEvent } from './protocol/v1.js';

export interface DedicatedWorkerScopeLike {
  postMessage(message: WorkerEvent): void;
  onmessage: ((event: MessageEvent<WorkerCommand>) => void) | null;
}

/**
 * Versions forwarded to the core runtime; should match the artifact manifest
 * (`manifest.abiVersion`, build id / commit tag). Defaults are dev-mode values.
 */
export interface AttachWorkerRuntimeOptions {
  abiVersion?: string;
  buildId?: string;
}

export function attachWorkerRuntime(
  scope: DedicatedWorkerScopeLike,
  createAdapter: () => WasmAdapter,
  options: AttachWorkerRuntimeOptions = {},
): WorkerRuntimeController {
  const controller = new WorkerRuntimeController({
    createCoreRuntime: (eventSink) => createCoreRuntime({
      adapter: createAdapter(),
      versions: {
        abiVersion: options.abiVersion ?? '0.1.0',
        buildId: options.buildId ?? 'dev',
      },
      eventSink,
    }),
    emit: (event) => scope.postMessage(event),
  });
  scope.onmessage = (event) => {
    void controller.dispatch(event.data);
  };
  return controller;
}
