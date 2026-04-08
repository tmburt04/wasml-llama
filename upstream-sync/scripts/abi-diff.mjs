import { abiContractPath, newestVersionDirectory, readJson, run, repoRoot } from './helpers.mjs';
import { resolve } from 'node:path';

function parseNmSymbols(output) {
  return output
    .split('\n')
    .map((line) => line.trim().split(/\s+/).at(-1))
    .filter(Boolean)
    .sort();
}

function readWasmSymbols(artifactPath) {
  const commands = [
    ['llvm-nm', ['-g', artifactPath]],
    ['wasm-nm', ['-g', artifactPath]],
    ['emnm', ['-g', artifactPath]],
  ];

  const failures = [];
  for (const [command, args] of commands) {
    try {
      return parseNmSymbols(run(command, args, repoRoot));
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(`Unable to inspect wasm exports for ${artifactPath}: ${failures.join(' | ')}`);
}

export function loadCurrentSymbols(version) {
  const selectedVersion = version ?? newestVersionDirectory(resolve(repoRoot, 'wasm-build', 'dist'));
  if (!selectedVersion) {
    return [];
  }
  const artifactPath = resolve(repoRoot, 'wasm-build', 'dist', selectedVersion, 'core.wasm');
  return readWasmSymbols(artifactPath);
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
