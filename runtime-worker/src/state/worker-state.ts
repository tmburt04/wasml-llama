import { createFault } from '@wasml-llama/runtime-core';
import type { WorkerState } from '../protocol/v1.js';

export type WorkerStateTransitionEvent =
  | 'begin-load'
  | 'load-ready'
  | 'start-inference'
  | 'finish-inference'
  | 'destroy'
  | 'fault';

const transitions: Record<WorkerState, Partial<Record<WorkerStateTransitionEvent, WorkerState>>> = {
  INIT: {
    'begin-load': 'LOADING',
    fault: 'ERROR',
  },
  LOADING: {
    'load-ready': 'READY',
    destroy: 'TERMINATED',
    fault: 'ERROR',
  },
  READY: {
    'begin-load': 'LOADING',
    'start-inference': 'RUNNING',
    destroy: 'TERMINATED',
    fault: 'ERROR',
  },
  RUNNING: {
    'finish-inference': 'READY',
    fault: 'ERROR',
  },
  ERROR: {
    destroy: 'TERMINATED',
  },
  TERMINATED: {},
};

export function transitionWorkerState(current: WorkerState, event: WorkerStateTransitionEvent): WorkerState {
  const next = transitions[current][event];
  if (!next) {
    throw createFault({
      category: 'protocol',
      code: 'PROTO_INVALID_STATE_TRANSITION',
      origin: 'runtime-worker',
      severity: 'error',
      recoverable: false,
      message: `invalid transition ${current} -> ${event}`,
      context: { current, event },
    });
  }
  return next;
}
