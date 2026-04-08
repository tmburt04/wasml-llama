import { createEmscriptenLlamaAdapter } from '../../runtime-core/dist/emscripten-adapter.js';
import { createFault, normalizeFault } from '../../runtime-core/dist/errors.js';

let adapter = null;
let cancelled = false;

function postDiag(id, message, extra = undefined) {
  self.postMessage({ type: 'diag', id, message, extra });
}

function ensureAdapter(operation) {
  if (adapter) {
    return adapter;
  }
  throw createFault({
    category: 'protocol',
    code: 'PROTO_BENCH_ADAPTER_NOT_READY',
    origin: 'runtime-worker',
    severity: 'error',
    recoverable: false,
    message: `adapter not ready for ${operation}`,
    context: { operation },
  });
}

function postFault(id, error, fallback) {
  const fault = normalizeFault(error, fallback).toJSON();
  postDiag(id, fault.message, fault);
  self.postMessage({ type: 'error', id, payload: { fault }, fault });
}

function defaultFaultForMessage(msg) {
  switch (msg?.type) {
    case 'init':
      return {
        category: 'initialization',
        code: 'BENCH_INIT_FAILED',
      };
    case 'load':
      return {
        category: 'model',
        code: 'BENCH_MODEL_LOAD_FAILED',
      };
    case 'generate':
    case 'infer':
    case 'cancel':
      return {
        category: 'inference',
        code: 'BENCH_INFERENCE_FAILED',
      };
    case 'destroy':
      return {
        category: 'protocol',
        code: 'BENCH_DESTROY_FAILED',
      };
    default:
      return {
        category: 'protocol',
        code: 'BENCH_WORKER_COMMAND_FAILED',
      };
  }
}

self.onmessage = async (event) => {
  const msg = event.data;
  try {
    switch (msg.type) {
      case 'init':
        postDiag(msg.id, 'worker init requested', {
          backend: msg.backend,
          modulePath: msg.modulePath,
          wasmPath: msg.wasmPath ?? null,
          contextSize: msg.contextSize,
        });
        adapter = createEmscriptenLlamaAdapter({
          modulePath: msg.modulePath,
          wasmPath: msg.wasmPath,
          backend: msg.backend,
          contextSize: msg.contextSize,
          modelVirtualPath: '/models/model.gguf',
        });
        await adapter.initialize((entry) => {
          self.postMessage({ type: 'diag', id: msg.id, message: entry.message, extra: entry });
        });
        postDiag(msg.id, 'worker init complete');
        self.postMessage({ type: 'ready', id: msg.id });
        break;

      case 'load': {
        const readyAdapter = ensureAdapter('load');
        const bytes = new Uint8Array(msg.bytes);
        postDiag(msg.id, 'model load begin', { bytes: bytes.byteLength });
        await readyAdapter.beginModelLoad({ totalBytes: bytes.byteLength, expectedChunks: 1 });
        await readyAdapter.writeModelChunk(bytes);
        await readyAdapter.finalizeModelLoad();
        postDiag(msg.id, 'model load complete', { bytes: bytes.byteLength });
        self.postMessage({ type: 'loaded', id: msg.id, bytesLoaded: bytes.byteLength });
        break;
      }

      case 'generate': {
        const readyAdapter = ensureAdapter('generate');
        cancelled = false;
        const rid = `r-${Date.now()}`;
        const maxTokens = msg.maxTokens || 48;
        postDiag(msg.id, 'generate begin', { requestId: rid, maxTokens });
        await readyAdapter.beginInference({
          requestId: rid,
          prompt: msg.prompt,
          maxTokens,
          sampling: { temperature: 0, topK: 1, topP: 1, seed: 0 },
        });
        const result = await readyAdapter.generateAll(rid, maxTokens);
        postDiag(msg.id, 'generate complete', { tokenCount: result.tokenCount });
        const snap = readyAdapter.getMemorySnapshot();
        self.postMessage({
          type: 'generated',
          id: msg.id,
          text: result.text,
          tokenCount: result.tokenCount,
          memoryBytes: snap.usedBytes,
        });
        break;
      }

      case 'infer': {
        const readyAdapter = ensureAdapter('infer');
        cancelled = false;
        const rid = `r-${Date.now()}`;
        const sampling = msg.sampling ?? { temperature: 0, topK: 1, topP: 1, seed: 0 };
        postDiag(msg.id, 'inference begin', { requestId: rid, maxTokens: msg.maxTokens, sampling });
        await readyAdapter.beginInference({
          requestId: rid,
          prompt: msg.prompt,
          maxTokens: msg.maxTokens,
          sampling,
        });
        let n = 0;
        while (n < msg.maxTokens && !cancelled) {
          const step = await readyAdapter.stepInference(rid, Math.min(8, msg.maxTokens - n));
          const emittedCount = step.token ? Math.max(1, step.tokenCount ?? 1) : 0;
          if (emittedCount > 0) {
            n += emittedCount;
            self.postMessage({ type: 'token', id: msg.id, text: step.token || '', tokenCount: emittedCount });
          }
          if (step.done) break;
        }
        if (cancelled) await readyAdapter.cancelInference(rid);
        const snap = readyAdapter.getMemorySnapshot();
        postDiag(msg.id, 'inference complete', { tokenCount: n, memoryBytes: snap.usedBytes });
        self.postMessage({ type: 'done', id: msg.id, tokenCount: n, memoryBytes: snap.usedBytes });
        break;
      }

      case 'cancel':
        cancelled = true;
        postDiag(msg.id, 'cancel requested');
        break;

      case 'destroy':
        await adapter?.destroy();
        adapter = null;
        postDiag(msg.id, 'worker destroyed');
        self.postMessage({ type: 'destroyed', id: msg.id });
        break;

      default:
        throw createFault({
          category: 'protocol',
          code: 'PROTO_BENCH_COMMAND_UNKNOWN',
          origin: 'runtime-worker',
          severity: 'error',
          recoverable: false,
          message: 'bench worker command unknown',
          context: { type: msg.type ?? null },
        });
    }
  } catch (error) {
    const fallback = defaultFaultForMessage(msg);
    postFault(msg.id, error, {
      category: fallback.category,
      code: fallback.code,
      origin: 'runtime-worker',
      severity: 'error',
      recoverable: false,
      context: { type: msg.type ?? null },
    });
  }
};
