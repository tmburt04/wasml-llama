import type { EmscriptenModuleFactory } from './types.js';

export async function importModule(modulePath: string): Promise<EmscriptenModuleFactory> {
  if (modulePath.startsWith('http://') || modulePath.startsWith('https://') || modulePath.startsWith('/')) {
    return (await import(/* @vite-ignore */ modulePath)) as EmscriptenModuleFactory;
  }
  const { pathToFileURL } = await import('node:url');
  return (await import(pathToFileURL(modulePath).href)) as EmscriptenModuleFactory;
}
