import { diffAbi } from './abi-diff.mjs';
import { syncUpstream } from './sync.mjs';

const [, , command, commandArg] = process.argv;

async function main() {
  if (command === 'sync') {
    console.log(JSON.stringify(syncUpstream(commandArg), null, 2));
    return;
  }
  if (command === 'abi-diff') {
    console.log(JSON.stringify(diffAbi(commandArg), null, 2));
    return;
  }
  throw new Error(`Unknown command: ${command ?? '<missing>'}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
