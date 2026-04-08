import type { BulkInferenceResult, InferenceSummary, ModelLoadSummary, TokenChunk } from '@wasml-llama/runtime-core';
import { WorkerRuntimeClient, type ModelInput, type RuntimeClient, type WorkerLike } from './client.js';

export interface RuntimePoolOptions {
  createWorker: () => WorkerLike;
  size: number;
}

export class RuntimePool implements RuntimeClient {
  readonly #clients: WorkerRuntimeClient[];
  readonly #inflightCounts: number[];
  #cursor = 0;

  constructor(options: RuntimePoolOptions) {
    this.#clients = Array.from({ length: options.size }, () => new WorkerRuntimeClient({
      createWorker: options.createWorker,
    }));
    this.#inflightCounts = Array.from({ length: options.size }, () => 0);
  }

  async initialize(): Promise<void> {
    await Promise.all(this.#clients.map(async (client) => client.initialize()));
  }

  async loadModel(source: ModelInput): Promise<ModelLoadSummary> {
    const materialized = source instanceof Uint8Array || source instanceof ArrayBuffer
      ? source
      : await materializeModel(source);
    const summaries = await Promise.all(this.#clients.map(async (client) => client.loadModel(
      materialized instanceof Uint8Array ? materialized.slice() : materialized.slice(0),
    )));
    return summaries[0] as ModelLoadSummary;
  }

  async *runInference(input: { prompt: string; maxTokens?: number; signal?: AbortSignal }): AsyncGenerator<TokenChunk, InferenceSummary> {
    const index = this.#pickClientIndex();
    this.#inflightCounts[index] = (this.#inflightCounts[index] ?? 0) + 1;
    try {
      const client = this.#clients[index];
      if (!client) {
        throw new Error(`worker client missing at index ${index}`);
      }
      const iterator = client.runInference(input)[Symbol.asyncIterator]();
      while (true) {
        const next = await iterator.next();
        if (next.done) {
          return next.value;
        }
        yield next.value;
      }
    } finally {
      this.#inflightCounts[index] = (this.#inflightCounts[index] ?? 1) - 1;
    }
  }

  async runInferenceBulk(input: { prompt: string; maxTokens?: number; signal?: AbortSignal }): Promise<BulkInferenceResult> {
    const index = this.#pickClientIndex();
    this.#inflightCounts[index] = (this.#inflightCounts[index] ?? 0) + 1;
    try {
      const client = this.#clients[index];
      if (!client) {
        throw new Error(`worker client missing at index ${index}`);
      }
      return await client.runInferenceBulk(input);
    } finally {
      this.#inflightCounts[index] = (this.#inflightCounts[index] ?? 1) - 1;
    }
  }

  cancelInference(requestId: string): Promise<void> {
    void requestId;
    throw new Error('cancel inference on the originating stream request');
  }

  async destroy(): Promise<void> {
    await Promise.all(this.#clients.map(async (client) => client.destroy()));
  }

  #pickClientIndex(): number {
    let bestIndex = this.#cursor;
    let bestLoad = Number.POSITIVE_INFINITY;
    for (let offset = 0; offset < this.#clients.length; offset += 1) {
      const index = (this.#cursor + offset) % this.#clients.length;
      const load = this.#inflightCounts[index] ?? 0;
      if (load < bestLoad) {
        bestLoad = load;
        bestIndex = index;
      }
    }
    this.#cursor = (bestIndex + 1) % this.#clients.length;
    return bestIndex;
  }
}

async function materializeModel(source: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of source) {
    chunks.push(chunk);
    total += chunk.byteLength;
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
