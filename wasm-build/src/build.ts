import { createHash } from 'node:crypto';
import { access, cp, mkdir, readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { basename, join, resolve } from 'node:path';
import { loadTargetConfig, loadToolchainConfig } from './targets.js';
import type { BuildBackend, BuildManifestV1, BuildMetadataV1, BuildTargetName } from './manifest.js';
import { writeManifest, writeMetadata } from './manifest.js';

export interface BuildOptions {
  version: string;
  upstreamCommit: string;
  abiVersion: string;
  backend: BuildBackend;
  threads: boolean;
  memory64: boolean;
  jspi: boolean;
  dryRun?: boolean;
  emdawnwebgpuDir?: string;
}

const repoRoot = resolve(import.meta.dirname, '..', '..');
const vendorRoot = resolve(repoRoot, 'upstream-sync', 'vendor', 'llama.cpp');
const overlayRoot = resolve(repoRoot, 'upstream-sync', 'overlays', 'wasml-llama');

export async function buildArtifacts(options: BuildOptions): Promise<{ manifest: BuildManifestV1; metadata: BuildMetadataV1 }> {
  const toolchain = await loadToolchainConfig();
  const targetNames: BuildTargetName[] = ['core', 'extended', 'debug'];
  const distRoot = resolve(repoRoot, 'wasm-build', 'dist', options.version);
  const buildRoot = resolve(repoRoot, 'wasm-build', '.build', options.version);

  await mkdir(distRoot, { recursive: true });
  await mkdir(buildRoot, { recursive: true });

  const commands = {} as BuildMetadataV1['commands'];
  const artifactBytes = {} as BuildMetadataV1['artifactBytes'];
  const targets = {} as BuildManifestV1['targets'];

  for (const targetName of targetNames) {
    const target = await loadTargetConfig(targetName);
    const targetBuildRoot = resolve(buildRoot, targetName);
    const cmakeArgs = [
      '-S', overlayRoot,
      '-B', targetBuildRoot,
      `-DWASML_LLAMA_VENDOR_DIR=${vendorRoot}`,
      `-DWASML_LLAMA_OUTPUT_NAME=${targetName}`,
      ...target.flags,
      options.memory64 ? '-DLLAMA_WASM_MEM64=ON' : '-DLLAMA_WASM_MEM64=OFF',
      options.backend === 'webgpu' ? '-DGGML_WEBGPU=ON' : '-DGGML_WEBGPU=OFF',
      options.backend === 'webgpu' && options.jspi ? '-DGGML_WEBGPU_JSPI=ON' : '-DGGML_WEBGPU_JSPI=OFF',
      options.backend === 'webgpu' && toolchain.webgpu.debug ? '-DGGML_WEBGPU_DEBUG=ON' : '-DGGML_WEBGPU_DEBUG=OFF',
      options.threads ? '-DGGML_OPENMP=ON' : '-DGGML_OPENMP=OFF',
    ];
    if (options.emdawnwebgpuDir) {
      cmakeArgs.push(`-DEMDAWNWEBGPU_DIR=${options.emdawnwebgpuDir}`);
    }
    const compileFlags = [...toolchain.compileFlags, ...(options.threads ? toolchain.threadFlags : [])];
    commands[targetName] = [
      `emcmake cmake ${cmakeArgs.join(' ')} -DCMAKE_C_FLAGS="${compileFlags.join(' ')}" -DCMAKE_CXX_FLAGS="${compileFlags.join(' ')}"`,
      `cmake --build ${targetBuildRoot} --config Release`,
    ];

    const moduleOutput = resolve(targetBuildRoot, `${targetName}.js`);
    const wasmOutput = resolve(targetBuildRoot, `${targetName}.wasm`);
    if (!options.dryRun) {
      runCommand('emcmake', ['cmake', ...cmakeArgs, `-DCMAKE_C_FLAGS=${compileFlags.join(' ')}`, `-DCMAKE_CXX_FLAGS=${compileFlags.join(' ')}`], toolchain.deterministicEnv);
      runCommand('cmake', ['--build', targetBuildRoot, '--config', 'Release'], toolchain.deterministicEnv);
      const moduleDestination = resolve(distRoot, `${targetName}.js`);
      await cp(moduleOutput, moduleDestination);
      const moduleBytes = await readFile(moduleDestination);
      const hasSeparateWasm = await pathExists(wasmOutput);
      const wasmDestination = resolve(distRoot, `${targetName}.wasm`);
      const wasmBytes = hasSeparateWasm ? await copyAndReadOptionalFile(wasmOutput, wasmDestination) : null;
      targets[targetName] = {
        backend: options.backend,
        modulePath: `./${basename(moduleDestination)}`,
        ...(wasmBytes ? { wasmPath: `./${basename(wasmDestination)}` } : {}),
        sha256: createHash('sha256').update(wasmBytes ?? moduleBytes).digest('hex'),
        moduleSha256: createHash('sha256').update(moduleBytes).digest('hex'),
        flags: target.flags,
        features: [...target.features, ...(options.backend === 'webgpu' ? ['webgpu'] : ['cpu'])],
        memory: target.memory,
      };
      artifactBytes[targetName] = { wasm: wasmBytes?.byteLength ?? 0, module: moduleBytes.byteLength };
    } else {
      targets[targetName] = {
        backend: options.backend,
        modulePath: `./${targetName}.js`,
        wasmPath: `./${targetName}.wasm`,
        sha256: 'dry-run',
        moduleSha256: 'dry-run',
        flags: target.flags,
        features: [...target.features, ...(options.backend === 'webgpu' ? ['webgpu'] : ['cpu'])],
        memory: target.memory,
      };
      artifactBytes[targetName] = { wasm: 0, module: 0 };
    }
  }

  const manifest: BuildManifestV1 = {
    schemaVersion: 2,
    upstreamCommit: options.upstreamCommit,
    abiVersion: options.abiVersion,
    featureToggles: {
      simd: true,
      threads: options.threads,
      memory64: options.memory64,
      webgpu: options.backend === 'webgpu',
      jspi: options.backend === 'webgpu' ? options.jspi : false,
    },
    targets,
  };
  const metadata: BuildMetadataV1 = {
    schemaVersion: 2,
    version: options.version,
    builtAt: new Date().toISOString(),
    upstreamCommit: options.upstreamCommit,
    abiVersion: options.abiVersion,
    toolchainVersion: toolchain.version,
    backend: options.backend,
    jspi: options.backend === 'webgpu' ? options.jspi : false,
    commands,
    artifactBytes,
    browserGpuPolicy: 'bench-gated',
    ...(options.emdawnwebgpuDir ? { toolchainOverrides: { emdawnwebgpuDir: options.emdawnwebgpuDir } } : {}),
  };

  await writeManifest(join(distRoot, 'manifest.json'), manifest);
  await writeMetadata(join(distRoot, 'build-metadata.json'), metadata);
  return { manifest, metadata };
}

function runCommand(command: string, args: string[], deterministicEnv: Record<string, string>): void {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, ...deterministicEnv },
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status ?? 1}`);
  }
}

export async function inspectArtifactDirectory(version: string): Promise<{ manifestBytes: number; metadataBytes: number }> {
  const distRoot = resolve(repoRoot, 'wasm-build', 'dist', version);
  const manifestStat = await stat(resolve(distRoot, 'manifest.json'));
  const metadataStat = await stat(resolve(distRoot, 'build-metadata.json'));
  return {
    manifestBytes: manifestStat.size,
    metadataBytes: metadataStat.size,
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function copyAndReadOptionalFile(source: string, destination: string): Promise<Buffer> {
  await cp(source, destination);
  return readFile(destination);
}
