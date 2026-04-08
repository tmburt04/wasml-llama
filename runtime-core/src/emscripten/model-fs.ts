import type { EmscriptenModuleInstance } from './types.js';

export function concatChunks(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 0) {
    return new Uint8Array(0);
  }
  if (chunks.length === 1) {
    return chunks[0] ?? new Uint8Array(0);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export function ensureFsPath(module: EmscriptenModuleInstance, path: string): void {
  const segments = path.split('/').filter(Boolean);
  let current = '';
  for (const segment of segments) {
    current += `/${segment}`;
    if (!module.FS?.analyzePath(current).exists) {
      module.FS?.mkdir(current);
    }
  }
}
