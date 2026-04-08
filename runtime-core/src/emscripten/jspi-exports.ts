import type { EmscriptenExportFunction, EmscriptenModuleInstance, PromisingWebAssembly } from './types.js';

export function installPromisingExportWrappers(module: EmscriptenModuleInstance, exportNames: string[]): void {
  const promising = (globalThis.WebAssembly as PromisingWebAssembly | undefined)?.promising;
  if (typeof promising !== 'function') {
    return;
  }
  for (const exportName of exportNames) {
    const fn = module[exportName];
    if (isExportFunction(fn)) {
      module[exportName] = promising(fn);
    }
  }
}

export async function callPromisingStringExport(
  module: EmscriptenModuleInstance,
  exportName: string,
  text: string,
  args: Array<number>,
): Promise<number> {
  const heap = module.HEAPU8 ?? (module.wasmMemory ? new Uint8Array(module.wasmMemory.buffer) : undefined);
  const malloc = module['_malloc'];
  const free = module['_free'];
  const fn = module[exportName];
  if (!isExportFunction(malloc) || !isExportFunction(free) || !isExportFunction(fn)) {
    throw new Error(`missing wasm export plumbing for ${exportName}`);
  }

  const allocationSize = (module.lengthBytesUTF8?.(text) ?? new TextEncoder().encode(text).byteLength) + 1;
  const pointer = allocateCString(module, malloc, heap, text, allocationSize);
  const wasmPointer = normalizeWasmPointer(pointer);

  try {
    return Number(await fn(wasmPointer, ...args));
  } finally {
    free(wasmPointer);
  }
}

function allocateCString(
  module: EmscriptenModuleInstance,
  malloc: EmscriptenExportFunction,
  heap: Uint8Array | undefined,
  text: string,
  allocationSize: number,
): number | bigint {
  let pointer: number | bigint;
  try {
    pointer = malloc(BigInt(allocationSize)) as number | bigint;
  } catch {
    pointer = malloc(allocationSize) as number | bigint;
  }
  if (typeof module.stringToUTF8 === 'function') {
    module.stringToUTF8(text, pointer, allocationSize);
    return pointer;
  }
  if (!(heap instanceof Uint8Array)) {
    throw new Error('missing utf8 helpers');
  }
  const encoded = new TextEncoder().encode(text);
  const offset = Number(pointer);
  heap.set(encoded, offset);
  heap[offset + encoded.byteLength] = 0;
  return pointer;
}

function normalizeWasmPointer(pointer: number | bigint): number | bigint {
  if (typeof pointer === 'bigint') {
    return pointer;
  }
  try {
    return BigInt(pointer);
  } catch {
    return pointer;
  }
}

function isExportFunction(value: unknown): value is EmscriptenExportFunction {
  return typeof value === 'function';
}
