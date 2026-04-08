import { readFile } from 'node:fs/promises';
import type { BuildManifestV1, BuildMetadataV1 } from '@wasml-llama/wasm-build';

export interface ArtifactInspection {
  manifest: BuildManifestV1;
  metadata: BuildMetadataV1;
}

export async function inspectArtifacts(manifestPath: string, metadataPath: string): Promise<ArtifactInspection> {
  const [manifestRaw, metadataRaw] = await Promise.all([
    readFile(manifestPath, 'utf8'),
    readFile(metadataPath, 'utf8'),
  ]);
  return {
    manifest: JSON.parse(manifestRaw) as BuildManifestV1,
    metadata: JSON.parse(metadataRaw) as BuildMetadataV1,
  };
}
