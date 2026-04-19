import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildArtifacts } from './build.js';

const args = process.argv.slice(2);
const command = args[0];

function readFlag(name: string, fallback?: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return fallback;
  }
  return args[index + 1];
}

async function main(): Promise<void> {
  if (command === 'build') {
    const version = readFlag('--version', 'dev') ?? 'dev';
    const upstreamCommit = readFlag('--upstream-commit', 'unknown-upstream') ?? 'unknown-upstream';
    const upstreamTag = readFlag('--upstream-tag');
    const abiVersion = readFlag('--abi-version', '0.2.0') ?? '0.2.0';
    const backend = (readFlag('--backend', 'cpu') ?? 'cpu') as 'cpu' | 'webgpu';
    const threads = args.includes('--threads');
    const memory64 = !args.includes('--no-memory64');
    const dryRun = args.includes('--dry-run');
    const jspi = !args.includes('--no-jspi');
    const emdawnwebgpuDir = readFlag('--emdawnwebgpu-dir');
      console.log(JSON.stringify(await buildArtifacts({
        version,
        upstreamCommit,
        ...(upstreamTag ? { upstreamTag } : {}),
        abiVersion,
        backend,
        threads,
        memory64,
        jspi,
        dryRun,
        ...(emdawnwebgpuDir ? { emdawnwebgpuDir } : {}),
      }), null, 2));
    return;
  }
  if (command === 'manifest') {
    const version = readFlag('--version', 'dev') ?? 'dev';
    const manifestPath = resolve(process.cwd(), 'wasm-build', 'dist', version, 'manifest.json');
    console.log(await readFile(manifestPath, 'utf8'));
    return;
  }
  throw new Error(`Unknown command: ${command ?? '<missing>'}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
