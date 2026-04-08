import type { SerializableFault } from '@wasml-llama/runtime-core';

export interface RecoveryPlan {
  action: 'none' | 'retry-model-load' | 'restart-worker' | 'reject-request';
  delayMs: number;
  shouldTerminateWorker: boolean;
}

export function planRecovery(fault: SerializableFault): RecoveryPlan {
  switch (fault.category) {
    case 'memory':
      return { action: 'restart-worker', delayMs: 0, shouldTerminateWorker: true };
    case 'model':
      return { action: 'retry-model-load', delayMs: 250, shouldTerminateWorker: false };
    case 'protocol':
      return { action: 'reject-request', delayMs: 0, shouldTerminateWorker: false };
    case 'build':
    case 'initialization':
    case 'inference':
    default:
      return { action: 'restart-worker', delayMs: 0, shouldTerminateWorker: true };
  }
}
