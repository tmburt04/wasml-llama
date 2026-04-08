import { describe, expect, it } from 'vitest';
import { WorkerRuntimeClient } from '@wasml-llama/runtime-api';
import { FakeAdapter } from '../support/fake-adapter.js';
import { createLocalWorker } from '../support/fake-worker.js';

describe('failure injection', () => {
  it('retries corrupted model load with backoff', async () => {
    let remainingFailures = 1;
    const client = new WorkerRuntimeClient({
      createWorker: () => createLocalWorker(() => {
        const failFinalizeAttempts = remainingFailures > 0 ? 1 : 0;
        remainingFailures = Math.max(remainingFailures - 1, 0);
        return new FakeAdapter({ failFinalizeAttempts });
      }),
    });
    const summary = await client.loadModel(new Uint8Array([1, 2, 3, 4]));
    expect(summary.bytesLoaded).toBe(4);
    await client.destroy();
  });

  it('fails partial downloads clearly', async () => {
    const client = new WorkerRuntimeClient({
      createWorker: () => createLocalWorker(() => new FakeAdapter({ failOnPartialModel: true })),
    });
    await expect(client.loadModel(new Uint8Array([1, 2]))).rejects.toMatchObject({ code: 'MODEL_PARTIAL_DOWNLOAD' });
    await client.destroy();
  });

  it('fails on OOM without silent recovery', async () => {
    const client = new WorkerRuntimeClient({
      createWorker: () => createLocalWorker(() => new FakeAdapter({ memoryLimitBytes: 2 })),
    });
    await expect(client.loadModel(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({ code: 'MEMORY_OVERFLOW' });
    await client.destroy();
  });
});
