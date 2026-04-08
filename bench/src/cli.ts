import { DEFAULT_MODEL, DEFAULT_THRESHOLDS } from './config.js';
import { runBrowserBench } from './browser-benchmark.js';
import { runNodeBench } from './node-benchmark.js';
import { evaluateRegressions, readBaseline, writeBenchReport } from './result-writer.js';
import type { BenchArtifactConfig, BenchBackend, BenchEnvironment, BenchRunConfig, BenchSample } from './types.js';

async function main(): Promise<void> {
  const [command = 'node'] = process.argv.slice(2);
  const commit = readFlag('--commit', 'local-dev');
  const defaultVersion = command === 'browser' ? 'local-webgpu' : 'local-cpu';
  const version = readFlag('--version', defaultVersion);
  const target = readFlag('--target', 'core') as BenchArtifactConfig['target'];
  const backend = readFlag('--backend', command === 'browser' ? 'webgpu' : 'cpu') as BenchBackend;
  const baselinePath = readOptionalFlag('--baseline');
  const environment = (command === 'browser' ? 'chrome' : 'node') as BenchEnvironment;
  const modelUrl = readFlag('--model-url', DEFAULT_MODEL.sourceUrl);
  const modelFilename = readFlag('--model-file', DEFAULT_MODEL.filename);
  const prompt = readFlag('--prompt', DEFAULT_MODEL.prompt);
  const maxTokens = Number(readFlag('--max-tokens', String(DEFAULT_MODEL.maxTokens)));
  const chromeExecutablePath = readOptionalFlag('--chrome');
  const config: BenchRunConfig = {
    model: {
      ...DEFAULT_MODEL,
      sourceUrl: modelUrl,
      filename: modelFilename,
      prompt,
      maxTokens,
    },
    artifact: { version, target, backend },
    environment,
    preferWebGpu: backend === 'webgpu',
    prompt,
    maxTokens,
    chromeExecutablePath,
  };

  const samples: BenchSample[] = [];
  samples.push(command === 'browser'
    ? await runBrowserBench(config, commit)
    : await runNodeBench(config, commit));

  const baseline = await readBaseline(baselinePath);
  const regressions = evaluateRegressions(samples, baseline, DEFAULT_THRESHOLDS);
  const reportPath = await writeBenchReport(commit, { samples, regressions, model: config.model });
  console.log(JSON.stringify({ reportPath, regressions, samples }, null, 2));
  if (regressions.length > 0) {
    process.exitCode = 1;
  }
}

function readFlag(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

function readOptionalFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
