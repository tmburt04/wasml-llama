import { abiContractPath, exists, patchSeriesPath, readJson, repoRoot, run, vendorRoot } from './helpers.mjs';
import { resolve } from 'node:path';

function ensureVendorCheckout() {
  if (exists(resolve(vendorRoot, '.git'))) {
    return;
  }
  run('git', ['clone', '--depth', '1', 'https://github.com/ggml-org/llama.cpp.git', vendorRoot], repoRoot);
}

const releaseTagPattern = /^b\d+$/;

function isReleaseTag(value) {
  return typeof value === 'string' && releaseTagPattern.test(value);
}

function resolveLatestReleaseTag() {
  const refs = run('git', ['ls-remote', '--tags', '--refs', 'https://github.com/ggml-org/llama.cpp.git', 'refs/tags/b*'], repoRoot);
  let latest = -1;
  let latestTag = null;
  for (const line of refs.split('\n')) {
    const match = line.match(/refs\/tags\/(b\d+)$/);
    if (!match) continue;
    const num = Number(match[1].slice(1));
    if (num > latest) {
      latest = num;
      latestTag = match[1];
    }
  }
  if (!latestTag) {
    throw new Error('Unable to resolve latest llama.cpp release tag');
  }
  return latestTag;
}

function fetchUpstream(target) {
  let tag = isReleaseTag(target) ? target : null;
  if (!target) {
    tag = resolveLatestReleaseTag();
  }
  const ref = tag ? `refs/tags/${tag}` : target;
  run('git', ['fetch', '--depth', '1', '--tags', 'origin', ref], vendorRoot);
  const commit = run('git', ['rev-parse', 'FETCH_HEAD'], vendorRoot);
  return { commit, tag };
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

export function syncUpstream(target) {
  ensureVendorCheckout();
  const previousCommit = currentVendorCommit();
  const { commit: upstreamCommit, tag: upstreamTag } = fetchUpstream(target);
  fastForward(upstreamCommit);
  applyPatches();
  const contract = readJson(abiContractPath);
  const updated = previousCommit !== upstreamCommit;
  return {
    upstreamCommit,
    upstreamTag,
    previousCommit,
    updated,
    changelog: updated ? changelog(previousCommit, upstreamCommit) : '',
    abiVersion: contract.abiVersion,
  };
}
