import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

export const repoRoot = resolve(import.meta.dirname, '..', '..');
export const vendorRoot = resolve(repoRoot, 'upstream-sync', 'vendor', 'llama.cpp');
export const patchSeriesPath = resolve(repoRoot, 'upstream-sync', 'patches', 'series.json');
export const abiContractPath = resolve(repoRoot, 'upstream-sync', 'abi', 'contract.json');

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function run(command, args, cwd = repoRoot) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'pipe',
    encoding: 'utf8',
  });
  if (result.error) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    const detail = stderr || stdout || 'unknown command failure';
    throw new Error(`${command} ${args.join(' ')} failed: ${detail}`);
  }
  return result.stdout.trim();
}

export function exists(path) {
  return existsSync(path);
}

export function newestVersionDirectory(path) {
  if (!existsSync(path)) {
    return null;
  }
  const candidates = readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();
  return candidates[0] ?? null;
}

export function stableEvent(code, message, context = {}) {
  return {
    timestamp: new Date().toISOString(),
    origin: 'upstream-sync',
    severity: 'info',
    recoverable: false,
    code,
    message,
    context,
  };
}
