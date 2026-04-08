import { spawnSync } from 'node:child_process';

const result = spawnSync('node', ['upstream-sync/scripts/cli.mjs', 'sync'], {
  cwd: process.cwd(),
  stdio: 'inherit',
});

process.exitCode = result.status ?? 1;
