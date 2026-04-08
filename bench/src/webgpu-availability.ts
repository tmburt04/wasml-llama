import { appendFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import { createChromeLaunchProfile, resolveChromeExecutablePath } from './chrome-profile.js';

async function setGithubOutput(name: string, value: string): Promise<void> {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    return;
  }
  await appendFile(outputPath, `${name}=${value.replace(/\r?\n/g, ' ')}\n`, 'utf8');
}

function logResult(available: boolean, reason: string): void {
  console.log(JSON.stringify({ available, reason }, null, 2));
}

async function main(): Promise<void> {
  const chromeExecutablePath = await resolveChromeExecutablePath(process.env.CHROME_BIN);
  if (!chromeExecutablePath) {
    await setGithubOutput('available', 'false');
    await setGithubOutput('reason', 'chrome-unavailable');
    logResult(false, 'chrome-unavailable');
    return;
  }

  const chromeProfile = createChromeLaunchProfile();
  const browser = await puppeteer.launch({
    executablePath: chromeExecutablePath,
    headless: chromeProfile.headless,
    args: chromeProfile.args,
  });

  try {
    const status = await (await browser.newPage()).evaluate(async () => {
      const hasNavigatorGpu = Boolean(navigator.gpu);
      const hasJspi = typeof (globalThis.WebAssembly as typeof WebAssembly & { promising?: unknown }).promising === 'function';
      let hasAdapter = false;
      let adapterError: string | null = null;

      if (navigator.gpu) {
        try {
          hasAdapter = Boolean(await navigator.gpu.requestAdapter());
        } catch (error) {
          adapterError = error instanceof Error ? error.message : String(error);
        }
      }

      return { hasNavigatorGpu, hasJspi, hasAdapter, adapterError };
    });

    const available = status.hasNavigatorGpu && status.hasJspi && status.hasAdapter;
    const reason = available
      ? 'webgpu-available'
      : !status.hasNavigatorGpu
        ? 'navigator.gpu-unavailable'
        : !status.hasAdapter
          ? `webgpu-adapter-unavailable${status.adapterError ? `: ${status.adapterError}` : ''}`
          : 'webassembly-promising-unavailable';

    await setGithubOutput('available', String(available));
    await setGithubOutput('reason', reason);
    logResult(available, reason);
  } finally {
    await browser.close();
  }
}

main().catch(async (error) => {
  const reason = error instanceof Error ? error.message : String(error);
  await setGithubOutput('available', 'false');
  await setGithubOutput('reason', `preflight-error: ${reason}`);
  console.error(reason);
  process.exitCode = 0;
});
