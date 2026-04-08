import { spawnSync } from 'node:child_process';

const result = spawnSync('node', ['upstream-sync/scripts/cli.mjs', 'sync', ...process.argv.slice(2)], {
  cwd: process.cwd(),
  stdio: 'inherit',
});

process.exitCode = result.status ?? 1;
