import type { BuildManifestV1 } from '@wasml-llama/wasm-build';

export interface CompatibilityReport {
  environment: 'chrome' | 'firefox' | 'node';
  supported: boolean;
  reasons: string[];
}

export function checkCompatibility(manifest: BuildManifestV1): CompatibilityReport[] {
  return [evaluate('chrome', manifest), evaluate('firefox', manifest), evaluate('node', manifest)];
}

function evaluate(environment: CompatibilityReport['environment'], manifest: BuildManifestV1): CompatibilityReport {
  const reasons: string[] = [];
  let supported = true;
  if (manifest.featureToggles.threads) {
    reasons.push(environment === 'node' ? 'requires worker thread support' : 'requires cross-origin isolation');
  }
  if (manifest.featureToggles.memory64) {
    reasons.push('memory64 must be verified in the target runtime');
  }
  if (manifest.featureToggles.webgpu) {
    if (environment === 'node') {
      supported = false;
      reasons.push('webgpu target is browser-only for this runtime');
    } else {
      reasons.push('requires navigator.gpu and a compatible WebGPU adapter');
    }
  }
  if (manifest.featureToggles.jspi && environment === 'firefox') {
    reasons.push('jspi support must be verified in Firefox before release qualification');
  }
  return { environment, supported, reasons };
}
