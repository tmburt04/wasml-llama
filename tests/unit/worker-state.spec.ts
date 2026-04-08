import { describe, expect, it } from 'vitest';
import { transitionWorkerState } from '@wasml-llama/runtime-worker';

describe('transitionWorkerState', () => {
  it('allows explicit loading and inference transitions', () => {
    expect(transitionWorkerState('INIT', 'begin-load')).toBe('LOADING');
    expect(transitionWorkerState('LOADING', 'load-ready')).toBe('READY');
    expect(transitionWorkerState('READY', 'start-inference')).toBe('RUNNING');
    expect(transitionWorkerState('RUNNING', 'finish-inference')).toBe('READY');
  });

  it('rejects implicit transitions', () => {
    expect(() => transitionWorkerState('INIT', 'start-inference')).toThrowError(/invalid transition/);
  });
});
