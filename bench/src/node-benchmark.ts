import { performance } from 'node:perf_hooks';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createCoreRuntime, createEmscriptenLlamaAdapter } from '@wasml-llama/runtime-core';
import type { BuildManifestV1 } from '@wasml-llama/wasm-build';
import type { BenchRunConfig, BenchSample } from './types.js';

export async function runNodeBench(config: BenchRunConfig, commit: string): Promise<BenchSample> {
  const manifest = await loadManifest(config.artifact.manifestPath, config.artifact.version);
  const target = manifest.targets[config.artifact.target];
  const modelBytes = await fetchBytes(config.model.sourceUrl);

  const adapter = createEmscriptenLlamaAdapter({
    modulePath: resolve(process.cwd(), 'wasm-build', 'dist', config.artifact.version, target.modulePath),
    ...(target.wasmPath
      ? {
          wasmPath: resolve(process.cwd(), 'wasm-build', 'dist', config.artifact.version, target.wasmPath),
        }
      : {}),
    backend: config.artifact.backend,
    contextSize: 4096,
    modelVirtualPath: `/models/${config.model.filename}`,
  });
  const runtime = createCoreRuntime({
    adapter,
    versions: { abiVersion: manifest.abiVersion, buildId: config.artifact.version },
  });

  const startupStart = performance.now();
  await runtime.initialize();
  const startupLatencyMs = performance.now() - startupStart;

  const loadStart = performance.now();
  await runtime.beginModelLoad({ totalBytes: modelBytes.byteLength, expectedChunks: 1 });
  await runtime.appendModelChunk(modelBytes);
  await runtime.commitModelLoad();
  const modelLoadLatencyMs = performance.now() - loadStart;

  const decodeStart = performance.now();
  const bulkResult = await runtime.runInferenceBulk({ prompt: config.prompt, maxTokens: config.maxTokens });
  const decodeLatencyMs = performance.now() - decodeStart;
  const snapshot = adapter.getMemorySnapshot();
  await runtime.destroy();

  return {
    commit,
    version: config.artifact.version,
    modelId: config.model.id,
    backend: config.artifact.backend,
    environment: 'node',
    environmentDetails: {
      compatibilityKey: `node:${process.version}:${process.platform}:${process.arch}`,
      nodeVersion: process.version,
      os: `${process.platform}-${process.arch}`,
      platform: process.platform,
    },
    metrics: {
      startupLatencyMs,
      downloadLatencyMs: 0,
      modelLoadLatencyMs,
      promptLatencyMs: 0,
      decodeLatencyMs,
      tokensPerSecond: bulkResult.generatedTokens === 0 ? 0 : bulkResult.generatedTokens / (decodeLatencyMs / 1000),
      peakMemoryBytes: snapshot.limitBytes ?? snapshot.usedBytes,
    },
    outputText: bulkResult.text,
    outputTokens: bulkResult.generatedTokens,
    artifactSha256: target.sha256,
    upstreamCommit: manifest.upstreamCommit,
    recordedAt: new Date().toISOString(),
  };
}

async function loadManifest(overridePath: string | undefined, version: string): Promise<BuildManifestV1> {
  const path = overridePath ?? resolve(process.cwd(), 'wasm-build', 'dist', version, 'manifest.json');
  return JSON.parse(await readFile(path, 'utf8')) as BuildManifestV1;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`failed to fetch model: ${response.status} ${response.statusText}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}
