import { abiContractPath, newestVersionDirectory, readJson, run, repoRoot } from './helpers.mjs';
import { resolve } from 'node:path';

export function loadCurrentSymbols(version) {
  const selectedVersion = version ?? newestVersionDirectory(resolve(repoRoot, 'wasm-build', 'dist'));
  if (!selectedVersion) {
    return [];
  }
  const artifactPath = resolve(repoRoot, 'wasm-build', 'dist', selectedVersion, 'core.wasm');
  const output = run('nm', ['-g', artifactPath], repoRoot);
  return output
    .split('\n')
    .map((line) => line.trim().split(/\s+/).at(-1))
    .filter(Boolean)
    .sort();
}

export function diffAbi(version) {
  const contract = readJson(abiContractPath);
  const currentSymbols = loadCurrentSymbols(version);
  const missingSymbols = contract.requiredSymbols.filter((symbol) => !currentSymbols.includes(symbol));
  return {
    abiVersion: contract.abiVersion,
    missingSymbols,
    currentSymbols,
  };
}
