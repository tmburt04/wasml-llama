import { describe, expect, it } from 'vitest';
import { WorkerRuntimeClient } from '@wasml-llama/runtime-api';
import { FakeAdapter } from '../support/fake-adapter.js';
import { createLocalWorker } from '../support/fake-worker.js';

describe('runtime api + worker integration', () => {
  it('loads a model and streams tokens', async () => {
    const client = new WorkerRuntimeClient({
      createWorker: () => createLocalWorker(() => new FakeAdapter()),
    });
    const summary = await client.loadModel(new Uint8Array([1, 2, 3, 4]));
    expect(summary.bytesLoaded).toBe(4);

    const iterator = client.runInference({ prompt: 'alpha beta gamma' })[Symbol.asyncIterator]();
    const tokens: string[] = [];
    while (true) {
      const next = await iterator.next();
      if (next.done) {
        expect(next.value.generatedTokens).toBe(3);
        break;
      }
      tokens.push(next.value.token);
    }
    expect(tokens).toEqual(['alpha', 'beta', 'gamma']);
    await client.destroy();
  });
});
