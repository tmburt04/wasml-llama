import { createCoreRuntime, type EventSink, type WasmAdapter } from '@wasml-llama/runtime-core';
import { WorkerRuntimeController, type WorkerCommand, type WorkerEvent } from '@wasml-llama/runtime-worker';
import type { WorkerLike } from '@wasml-llama/runtime-api';

export function createLocalWorker(adapterFactory: () => WasmAdapter): WorkerLike {
  const listeners = new Set<(event: MessageEvent<WorkerEvent>) => void>();
  const controller = new WorkerRuntimeController({
    createCoreRuntime: (eventSink: EventSink) => createCoreRuntime({
      adapter: adapterFactory(),
      versions: { abiVersion: '0.1.0', buildId: 'test' },
      eventSink,
    }),
    emit: (event) => {
      queueMicrotask(() => {
        for (const listener of listeners) {
          listener({ data: event } as MessageEvent<WorkerEvent>);
        }
      });
    },
  });
  return {
    postMessage(message: WorkerCommand) {
      void controller.dispatch(message);
    },
    addEventListener(_type, listener) {
      listeners.add(listener as (event: MessageEvent<WorkerEvent>) => void);
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener as (event: MessageEvent<WorkerEvent>) => void);
    },
    terminate() {
      listeners.clear();
    },
  };
}
