  import { mkdir, writeFile } from 'node:fs/promises';
  import { dirname } from 'node:path';

  export type BuildTargetName = 'core' | 'extended' | 'debug';
  export type BuildBackend = 'cpu' | 'webgpu';

  export interface BuildManifestV1 {
    schemaVersion: 2;
    upstreamCommit: string;
    abiVersion: string;
    featureToggles: {
      simd: boolean;
      threads: boolean;
      memory64: boolean;
      webgpu: boolean;
      jspi: boolean;
    };
    targets: Record<BuildTargetName, {
      backend: BuildBackend;
      modulePath: string;
      wasmPath?: string;
      sha256: string;
      moduleSha256: string;
      flags: string[];
      features: string[];
      memory: { minBytes: number; maxBytes: number | null };
    }>;
  }

  export interface BuildMetadataV1 {
    schemaVersion: 2;
    version: string;
    builtAt: string;
    upstreamCommit: string;
    abiVersion: string;
    toolchainVersion: string;
    backend: BuildBackend;
    jspi: boolean;
    commands: Record<BuildTargetName, string[]>;
    artifactBytes: Record<BuildTargetName, { wasm: number; module: number }>;
  browserGpuPolicy: 'bench-gated';
  toolchainOverrides?: {
    emdawnwebgpuDir?: string;
  };
  }

  export async function writeManifest(path: string, manifest: BuildManifestV1): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}
`, 'utf8');
  }

  export async function writeMetadata(path: string, metadata: BuildMetadataV1): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(metadata, null, 2)}
`, 'utf8');
  }
