import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { BuildManifestV1 } from '@wasml-llama/wasm-build';
import { inspectArtifacts } from './artifact-inspector.js';
import { checkCompatibility } from './compatibility-checker.js';
import { estimateMemoryRequirement } from './memory-estimator.js';

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'inspect') {
    const version = readFlag(args, '--version', 'local-cpu');
    const manifestPath = resolve(process.cwd(), 'wasm-build', 'dist', version, 'manifest.json');
    const metadataPath = resolve(process.cwd(), 'wasm-build', 'dist', version, 'build-metadata.json');
    console.log(JSON.stringify(await inspectArtifacts(manifestPath, metadataPath), null, 2));
    return;
  }
  if (command === 'estimate-memory') {
    const modelBytes = Number(readFlag(args, '--model-bytes', '0'));
    const contextTokens = Number(readFlag(args, '--context-tokens', '2048'));
    const threads = Number(readFlag(args, '--threads', '1'));
    const memory64 = args.includes('--memory64');
    console.log(JSON.stringify(estimateMemoryRequirement({ modelBytes, contextTokens, threads, memory64 }), null, 2));
    return;
  }
  if (command === 'check-compat') {
    const version = readFlag(args, '--version', 'local-cpu');
    const manifestPath = resolve(process.cwd(), 'wasm-build', 'dist', version, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as BuildManifestV1;
    console.log(JSON.stringify(checkCompatibility(manifest), null, 2));
    return;
  }
  throw new Error(`Unknown command: ${command ?? '<missing>'}`);
}

function readFlag(args: string[], name: string, fallback: string): string {
  const index = args.indexOf(name);
  return index === -1 ? fallback : (args[index + 1] ?? fallback);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
