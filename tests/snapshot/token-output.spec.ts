import { describe, expect, it } from 'vitest';
import { createCoreRuntime } from '@wasml-llama/runtime-core';
import { FakeAdapter } from '../support/fake-adapter.js';

describe('token output snapshot', () => {
  it('keeps deterministic token output stable', async () => {
    const runtime = createCoreRuntime({
      adapter: new FakeAdapter(),
      versions: { abiVersion: '0.1.0', buildId: 'snapshot' },
    });
    await runtime.initialize();
    await runtime.beginModelLoad({ totalBytes: 4, expectedChunks: 1 });
    await runtime.appendModelChunk(new Uint8Array([1, 2, 3, 4]));
    await runtime.commitModelLoad();
    const iterator = runtime.runInference({ prompt: 'llama cpp wasm' })[Symbol.asyncIterator]();
    const tokens: string[] = [];
    while (true) {
      const next = await iterator.next();
      if (next.done) {
        break;
      }
      tokens.push(next.value.token);
    }
    expect(tokens).toMatchInlineSnapshot(`
      [
        "llama",
        "cpp",
        "wasm",
      ]
    `);
    await runtime.destroy();
  });
});
