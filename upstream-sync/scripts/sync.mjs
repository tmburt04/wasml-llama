import { abiContractPath, exists, patchSeriesPath, readJson, repoRoot, run, vendorRoot } from './helpers.mjs';
import { diffAbi } from './abi-diff.mjs';
import { resolve } from 'node:path';

function ensureVendorCheckout() {
  if (exists(resolve(vendorRoot, '.git'))) {
    return;
  }
  run('git', ['clone', '--depth', '1', 'https://github.com/ggml-org/llama.cpp.git', vendorRoot], repoRoot);
}

function fetchUpstream(targetCommit) {
  if (targetCommit) {
    run('git', ['fetch', '--depth', '1', 'origin', targetCommit], vendorRoot);
    return run('git', ['rev-parse', 'FETCH_HEAD'], vendorRoot);
  }
  run('git', ['fetch', '--depth', '1', 'origin'], vendorRoot);
  const headRef = run('git', ['rev-parse', '--abbrev-ref', 'origin/HEAD'], vendorRoot);
  return run('git', ['rev-parse', headRef], vendorRoot);
}

function fastForward(targetCommit) {
  run('git', ['checkout', targetCommit], vendorRoot);
  return targetCommit;
}

function applyPatches() {
  const { patches } = readJson(patchSeriesPath);
  for (const patch of patches) {
    const patchPath = resolve(repoRoot, 'upstream-sync', 'patches', patch);
    run('git', ['apply', '--check', patchPath], vendorRoot);
    run('git', ['apply', patchPath], vendorRoot);
  }
}

function currentVendorCommit() {
  try {
    return run('git', ['rev-parse', 'HEAD'], vendorRoot);
  } catch {
    return null;
  }
}

function changelog(oldCommit, newCommit) {
  if (!oldCommit || oldCommit === newCommit) {
    return '';
  }
  try {
    return run('git', ['log', '--oneline', `${oldCommit}..${newCommit}`], vendorRoot);
  } catch {
    return '';
  }
}

export function syncUpstream(targetCommit) {
  ensureVendorCheckout();
  const previousCommit = currentVendorCommit();
  const upstreamCommit = fetchUpstream(targetCommit);
  fastForward(upstreamCommit);
  applyPatches();
  const abi = diffAbi();
  const contract = readJson(abiContractPath);
  if (abi.missingSymbols.length > 0) {
    throw new Error(`ABI drift detected for contract ${contract.abiVersion}: ${abi.missingSymbols.join(', ')}`);
  }
  const updated = previousCommit !== upstreamCommit;
  return {
    upstreamCommit,
    previousCommit,
    updated,
    changelog: updated ? changelog(previousCommit, upstreamCommit) : '',
    abiVersion: contract.abiVersion,
  };
}
