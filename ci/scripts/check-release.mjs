import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const version = process.env.RELEASE_VERSION ?? 'dev';
const manifestPath = resolve(process.cwd(), 'wasm-build', 'dist', version, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

// 'core' is always required; 'extended' and 'debug' are optional tiers.
const requiredTargets = ['core'];
const optionalTargets = ['extended', 'debug'];

for (const artifact of requiredTargets) {
  const target = manifest.targets?.[artifact];
  if (!target) {
    throw new Error(`Missing required artifact target: ${artifact}`);
  }
  if (!target.sha256) {
    throw new Error(`Missing wasm hash for ${artifact}`);
  }
  if (!target.moduleSha256) {
    throw new Error(`Missing module hash for ${artifact}`);
  }
  if (!target.modulePath) {
    throw new Error(`Missing modulePath for ${artifact}`);
  }
}

for (const artifact of optionalTargets) {
  const target = manifest.targets?.[artifact];
  if (!target) {
    continue;
  }
  if (!target.sha256 || !target.moduleSha256 || !target.modulePath) {
    throw new Error(`Incomplete artifact metadata for optional target: ${artifact}`);
  }
}

console.log(`Release ${version} passed manifest validation.`);
