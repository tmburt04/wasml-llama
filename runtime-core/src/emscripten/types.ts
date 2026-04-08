export interface EmscriptenModuleInstance {
  cwrap(name: string, returnType: string | null, argTypes: string[]): (...args: unknown[]) => unknown;
  ccall?(
    name: string,
    returnType: string | null,
    argTypes: string[],
    args: unknown[],
    opts?: Record<string, unknown>,
  ): unknown;
  FS?: {
    analyzePath(path: string): { exists: boolean };
    mkdir(path: string): void;
    writeFile(path: string, data: Uint8Array): void;
    unlink(path: string): void;
  };
  wasmMemory?: WebAssembly.Memory;
  HEAPU8?: Uint8Array;
  stringToUTF8?: (value: string, outPtr: number | bigint, maxBytesToWrite: number) => void;
  lengthBytesUTF8?: (value: string) => number;
  [key: string]: unknown;
}

export type EmscriptenExportFunction = (...args: unknown[]) => unknown;

export type PromisingWebAssembly = typeof WebAssembly & {
  promising?: (fn: EmscriptenExportFunction) => EmscriptenExportFunction;
};

export interface EmscriptenModuleFactory {
  default?: (options: Record<string, unknown>) => Promise<EmscriptenModuleInstance>;
}
