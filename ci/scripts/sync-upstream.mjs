import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const vendorDir = resolve(process.cwd(), 'upstream-sync', 'vendor');
const pinnedVersionPath = resolve(vendorDir, 'pinned-version');
const pinnedCommitPath = resolve(vendorDir, 'pinned-commit');

function readPinned(path) {
  if (!existsSync(path)) return null;
  const value = readFileSync(path, 'utf8').trim();
  return value || null;
}

function resolveSyncTarget() {
  const explicit = process.argv[2]?.trim();
  if (explicit) return explicit;
  return readPinned(pinnedVersionPath) ?? readPinned(pinnedCommitPath);
}

const target = resolveSyncTarget();

const result = spawnSync('node', ['upstream-sync/scripts/cli.mjs', 'sync', ...(target ? [target] : [])], {
  cwd: process.cwd(),
  stdio: 'inherit',
});

process.exitCode = result.status ?? 1;
