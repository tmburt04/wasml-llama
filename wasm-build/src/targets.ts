import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { BuildTargetName } from './manifest.js';

export interface BuildTargetConfig {
  name: BuildTargetName;
  features: string[];
  flags: string[];
  memory: { minBytes: number; maxBytes: number | null };
}

export interface ToolchainConfig {
  schemaVersion: 2;
  version: string;
  cacheMode: string;
  deterministicEnv: Record<string, string>;
  compileFlags: string[];
  threadFlags: string[];
  runtimeMethods: string[];
  webgpu: {
    portMode: 'builtin' | 'custom';
    jspi: boolean;
    debug: boolean;
  };
  notes: string;
}

const repoRoot = resolve(import.meta.dirname, '..');

export async function loadTargetConfig(name: BuildTargetName): Promise<BuildTargetConfig> {
  const path = resolve(repoRoot, 'config', 'targets', `${name}.json`);
  return JSON.parse(await readFile(path, 'utf8')) as BuildTargetConfig;
}

export async function loadToolchainConfig(): Promise<ToolchainConfig> {
  const path = resolve(repoRoot, 'config', 'toolchain', 'emscripten.json');
  return JSON.parse(await readFile(path, 'utf8')) as ToolchainConfig;
}
