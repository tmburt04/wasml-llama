import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pinnedCommitPath = resolve(process.cwd(), 'upstream-sync', 'vendor', 'pinned-commit');

function resolveSyncTarget() {
  const explicit = process.argv[2]?.trim();
  if (explicit) return explicit;
  if (existsSync(pinnedCommitPath)) {
    const pinned = readFileSync(pinnedCommitPath, 'utf8').trim();
    if (pinned) return pinned;
  }
  return null;
}

const target = resolveSyncTarget();

const result = spawnSync('node', ['upstream-sync/scripts/cli.mjs', 'sync', ...(target ? [target] : [])], {
  cwd: process.cwd(),
  stdio: 'inherit',
});

process.exitCode = result.status ?? 1;
