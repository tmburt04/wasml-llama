import type {
  GenerateAllResult,
  InferenceRequest,
  InferenceStep,
  MemorySnapshot,
  ModelLoadSessionOptions,
  ModelLoadSummary,
  WasmAdapter,
} from './adapter.js';
import { callPromisingStringExport, installPromisingExportWrappers } from './emscripten/jspi-exports.js';
import { importModule } from './emscripten/module-factory.js';
import { concatChunks, ensureFsPath } from './emscripten/model-fs.js';
import type { EmscriptenModuleInstance } from './emscripten/types.js';
import { createLogEvent, type EventSink } from './events.js';
import { createFault } from './errors.js';

export interface EmscriptenLlamaAdapterOptions {
  modulePath: string;
  wasmPath?: string;
  backend: 'cpu' | 'webgpu';
  contextSize: number;
  modelVirtualPath?: string;
}

const WEBGPU_PROMISING_EXPORTS = [
  '_wasml_backend_init',
  '_wasml_backend_free',
  '_wasml_load_model',
  '_wasml_unload_model',
  '_wasml_reset_state',
  '_wasml_begin_inference',
  '_wasml_step_inference',
  '_wasml_step_inference_many',
  '_wasml_generate_all',
];

export class EmscriptenLlamaAdapter implements WasmAdapter {
  readonly #options: EmscriptenLlamaAdapterOptions;
  #module: EmscriptenModuleInstance | null = null;
  #eventSink: EventSink | undefined;
  #modelChunks: Uint8Array[] = [];
  #activeRequestId: string | null = null;
  #cancelledRequestIds = new Set<string>();

  #backendInit: (() => number | Promise<number>) | undefined;
  #backendFree: (() => void | Promise<void>) | undefined;
  #loadModel: ((path: string, nCtx: number, nGpuLayers: number, useGpu: number, warmup: number) => number | Promise<number>) | undefined;
  #unloadModel: (() => void | Promise<void>) | undefined;
  #resetState: (() => void | Promise<void>) | undefined;
  #beginInference: ((prompt: string, addSpecial: number, topK: number, topP: number, temp: number, seed: number) => number | Promise<number>) | undefined;
  #stepInferenceFn: ((maxTokens: number) => number | Promise<number>) | undefined;
  #generateAllFn: ((maxTokens: number) => number | Promise<number>) | undefined;
  #lastTokenText: (() => string) | undefined;
  #lastChunkText: (() => string) | undefined;
  #lastChunkTokenCount: (() => number) | undefined;
  #lastTokenIsEog: (() => number) | undefined;
  #lastError: (() => string) | undefined;

  constructor(options: EmscriptenLlamaAdapterOptions) {
    this.#options = options;
  }

  async initialize(eventSink: EventSink): Promise<void> {
    if (this.#module) {
      this.#eventSink = eventSink;
      return;
    }
    this.#eventSink = eventSink;
    const imported = await importModule(this.#options.modulePath);
    const factory = imported.default;
    if (!factory) {
      throw createFault({ category: 'initialization', code: 'INIT_MODULE_FACTORY_MISSING', origin: 'runtime-core', severity: 'fatal', recoverable: false, message: 'module factory missing' });
    }
    this.#module = await factory({
      locateFile: (file: string, scriptDirectory?: string) =>
        file.endsWith('.wasm') && this.#options.wasmPath
          ? this.#options.wasmPath
          : `${scriptDirectory ?? ''}${file}`,
      noInitialRun: true,
      print: (message: string) => this.#emit('info', 'EMSCRIPTEN_STDOUT', message),
      printErr: (message: string) => this.#emit('warn', 'EMSCRIPTEN_STDERR', message),
    });
    if (this.#options.backend === 'webgpu') {
      installPromisingExportWrappers(this.#module, WEBGPU_PROMISING_EXPORTS);
    }
    this.#backendInit = this.#module.cwrap('wasml_backend_init', 'number', []) as () => number | Promise<number>;
    this.#backendFree = this.#module.cwrap('wasml_backend_free', null, []) as () => void | Promise<void>;
    this.#loadModel = this.#options.backend === 'webgpu'
      ? ((path: string, nCtx: number, nGpuLayers: number, useGpu: number, warmup: number) =>
        callPromisingStringExport(this.#requireModule(), '_wasml_load_model', path, [nCtx, nGpuLayers, useGpu, warmup])) as (path: string, nCtx: number, nGpuLayers: number, useGpu: number, warmup: number) => Promise<number>
      : (this.#module.cwrap('wasml_load_model', 'number', ['string', 'number', 'number', 'number', 'number']) as (path: string, nCtx: number, nGpuLayers: number, useGpu: number, warmup: number) => number);
    this.#unloadModel = this.#module.cwrap('wasml_unload_model', null, []) as () => void | Promise<void>;
    this.#resetState = this.#module.cwrap('wasml_reset_state', null, []) as () => void | Promise<void>;
    this.#beginInference = this.#options.backend === 'webgpu'
      ? ((prompt: string, addSpecial: number, topK: number, topP: number, temp: number, seed: number) =>
        callPromisingStringExport(this.#requireModule(), '_wasml_begin_inference', prompt, [addSpecial, topK, topP, temp, seed])) as (prompt: string, addSpecial: number, topK: number, topP: number, temp: number, seed: number) => Promise<number>
      : (this.#module.cwrap('wasml_begin_inference', 'number', ['string', 'number', 'number', 'number', 'number', 'number']) as (prompt: string, addSpecial: number, topK: number, topP: number, temp: number, seed: number) => number);
    this.#stepInferenceFn = (typeof this.#module['_wasml_step_inference_many'] === 'function'
      ? this.#module.cwrap('wasml_step_inference_many', 'number', ['number'])
      : this.#module.cwrap('wasml_step_inference', 'number', [])) as (maxTokens: number) => number | Promise<number>;
    this.#generateAllFn = typeof this.#module['_wasml_generate_all'] === 'function'
      ? this.#module.cwrap('wasml_generate_all', 'number', ['number']) as (maxTokens: number) => number | Promise<number>
      : undefined;
    this.#lastTokenText = this.#module.cwrap('wasml_last_token_text', 'string', []) as () => string;
    this.#lastChunkText = typeof this.#module['_wasml_last_chunk_text'] === 'function'
      ? this.#module.cwrap('wasml_last_chunk_text', 'string', []) as () => string
      : this.#lastTokenText;
    this.#lastChunkTokenCount = typeof this.#module['_wasml_last_chunk_token_count'] === 'function'
      ? this.#module.cwrap('wasml_last_chunk_token_count', 'number', []) as () => number
      : (() => 1);
    this.#lastTokenIsEog = this.#module.cwrap('wasml_last_token_is_eog', 'number', []) as () => number;
    this.#lastError = this.#module.cwrap('wasml_last_error', 'string', []) as () => string;
    this.#assertStatus(await this.#backendInit?.() ?? -1, 'INIT_BACKEND_FAILED');
  }

  async beginModelLoad(options: ModelLoadSessionOptions): Promise<void> {
    void options;
    this.#modelChunks = [];
    await this.#unloadModel?.();
  }

  async writeModelChunk(chunk: Uint8Array): Promise<void> {
    this.#modelChunks.push(chunk);
  }

  async finalizeModelLoad(): Promise<ModelLoadSummary> {
    const module = this.#requireModule();
    const modelBytes = concatChunks(this.#modelChunks);
    ensureFsPath(module, '/models');
    const modelPath = this.#options.modelVirtualPath ?? '/models/qwen3.5-0.8b.gguf';
    try {
      module.FS?.unlink(modelPath);
    } catch {
      // Ignore missing files in the virtual filesystem.
    }
    module.FS?.writeFile(modelPath, modelBytes);
    const useGpu = this.#options.backend === 'webgpu' ? 1 : 0;
    this.#assertStatus(await this.#loadModel?.(modelPath, this.#options.contextSize, useGpu ? -1 : 0, useGpu, 1) ?? -1, 'MODEL_LOAD_FAILED');
    return {
      bytesLoaded: modelBytes.byteLength,
      chunksLoaded: this.#modelChunks.length,
      modelId: modelPath.split('/').at(-1) ?? 'model.gguf',
      memoryRequiredBytes: this.getMemorySnapshot().limitBytes ?? modelBytes.byteLength,
    };
  }

  async beginInference(request: InferenceRequest): Promise<void> {
    this.#activeRequestId = request.requestId;
    this.#cancelledRequestIds.delete(request.requestId);
    await this.#resetState?.();
    const sampling = request.sampling ?? {};
    this.#assertStatus(await this.#beginInference?.(request.prompt, 1, sampling.topK ?? 40, sampling.topP ?? 0.95, sampling.temperature ?? 0.8, sampling.seed ?? 0xFFFFFFFF) ?? -1, 'INFER_BEGIN_FAILED');
  }

  async stepInference(requestId: string, maxTokens = 1): Promise<InferenceStep> {
    if (this.#cancelledRequestIds.has(requestId)) {
      return { done: true, stopReason: 'cancelled' };
    }
    const status = await this.#stepInferenceFn?.(maxTokens) ?? -1;
    if (status < 0) {
      this.#assertStatus(status, 'INFER_STEP_FAILED');
    }
    const token = this.#lastChunkText?.() ?? '';
    const tokenCount = token.length > 0 ? Math.max(1, this.#lastChunkTokenCount?.() ?? 1) : 0;
    if (status > 0) {
      return { done: true, stopReason: 'completed', ...(tokenCount > 0 ? { token, tokenCount } : {}) };
    }
    return {
      done: false,
      token,
      tokenCount,
      isSpecial: (this.#lastTokenIsEog?.() ?? 0) !== 0 && tokenCount <= 1,
    };
  }

  async generateAll(requestId: string, maxTokens: number): Promise<GenerateAllResult> {
    if (this.#cancelledRequestIds.has(requestId)) {
      return { text: '', tokenCount: 0, done: true };
    }
    if (!this.#generateAllFn) {
      return this.#generateAllFallback(requestId, maxTokens);
    }
    const status = await this.#generateAllFn(maxTokens);
    if (typeof status === 'number' && status < 0) {
      this.#assertStatus(status, 'INFER_GENERATE_FAILED');
    }
    const text = this.#lastChunkText?.() ?? '';
    const tokenCount = this.#lastChunkTokenCount?.() ?? 0;
    return { text, tokenCount, done: true };
  }

  async #generateAllFallback(requestId: string, maxTokens: number): Promise<GenerateAllResult> {
    let text = '';
    let tokenCount = 0;
    for (let i = 0; i < maxTokens; i++) {
      const step = await this.stepInference(requestId, 1);
      if (step.token) {
        text += step.token;
        tokenCount += step.tokenCount ?? 1;
      }
      if (step.done) break;
    }
    return { text, tokenCount, done: true };
  }

  async cancelInference(requestId: string): Promise<void> {
    this.#cancelledRequestIds.add(requestId);
    if (this.#activeRequestId === requestId) {
      await this.#resetState?.();
    }
  }

  getMemorySnapshot(): MemorySnapshot {
    const memory = this.#module?.wasmMemory?.buffer.byteLength ?? this.#module?.HEAPU8?.buffer.byteLength ?? null;
    return { usedBytes: memory ?? 0, limitBytes: memory };
  }

  async destroy(): Promise<void> {
    await this.#unloadModel?.();
    await this.#backendFree?.();
    this.#module = null;
    this.#backendInit = undefined;
    this.#backendFree = undefined;
    this.#loadModel = undefined;
    this.#unloadModel = undefined;
    this.#resetState = undefined;
    this.#beginInference = undefined;
    this.#stepInferenceFn = undefined;
    this.#generateAllFn = undefined;
    this.#lastTokenText = undefined;
    this.#lastChunkText = undefined;
    this.#lastChunkTokenCount = undefined;
    this.#lastTokenIsEog = undefined;
    this.#lastError = undefined;
  }

  #requireModule(): EmscriptenModuleInstance {
    if (!this.#module) {
      throw createFault({ category: 'initialization', code: 'INIT_MODULE_NOT_READY', origin: 'runtime-core', severity: 'fatal', recoverable: false, message: 'module not initialized' });
    }
    return this.#module;
  }

  #assertStatus(status: number, code: string): void {
    if (status >= 0) {
      return;
    }
    throw createFault({
      category: code.startsWith('MODEL') ? 'model' : code.startsWith('INFER') ? 'inference' : 'initialization',
      code,
      origin: 'runtime-core',
      severity: 'error',
      recoverable: false,
      message: this.#lastError?.() || code.toLowerCase(),
    });
  }

  #emit(severity: 'info' | 'warn', code: string, message: string): void {
    this.#eventSink?.(createLogEvent({ origin: 'runtime-core', severity, code, message }));
  }
}

export function createEmscriptenLlamaAdapter(options: EmscriptenLlamaAdapterOptions): WasmAdapter {
  return new EmscriptenLlamaAdapter(options);
}
