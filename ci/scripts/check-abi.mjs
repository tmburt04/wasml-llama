import { diffAbi } from '../../upstream-sync/scripts/abi-diff.mjs';

const version = process.env.RELEASE_VERSION ?? process.argv[2] ?? 'dev';
const abi = diffAbi(version);

if (abi.missingSymbols.length > 0) {
  throw new Error(`ABI drift detected for contract ${abi.abiVersion}: ${abi.missingSymbols.join(', ')}`);
}

console.log(`ABI ${abi.abiVersion} passed for ${version}.`);
