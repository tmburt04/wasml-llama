import { spawnSync } from 'node:child_process';

const commands = [
  ['npm', ['run', 'lint']],
  ['npm', ['run', 'typecheck']],
  ['npm', ['run', 'test']],
  ['npm', ['run', 'wasm:build:cpu', '--', '--version', `${process.env.RELEASE_VERSION ?? 'dev'}-cpu`]],
  ['node', ['ci/scripts/check-abi.mjs', `${process.env.RELEASE_VERSION ?? 'dev'}-cpu`]],
  ['npm', ['run', 'bench:node', '--', '--commit', `${process.env.RELEASE_VERSION ?? 'dev'}-cpu`, '--version', `${process.env.RELEASE_VERSION ?? 'dev'}-cpu`, '--backend', 'cpu', '--model-url', process.env.WASML_QWEN_MODEL_URL ?? 'https://huggingface.co/lmstudio-community/Qwen3.5-0.8B-GGUF/resolve/main/Qwen3.5-0.8B-Q4_K_M.gguf?download=1']],
];

for (const [command, args] of commands) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
