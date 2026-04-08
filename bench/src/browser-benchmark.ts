import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import {
  createChromeEnvironmentDetails,
  createChromeLaunchProfile,
  resolveChromeExecutablePath,
} from './chrome-profile.js';
import { DEFAULT_BROWSER_PORT } from './config.js';
import { startStaticServer } from './http-server.js';
import type { BenchRunConfig, BenchSample } from './types.js';

export async function runBrowserBench(config: BenchRunConfig, commit: string): Promise<BenchSample> {
  const chromeExecutablePath = await resolveChromeExecutablePath(config.chromeExecutablePath);
  if (!chromeExecutablePath) {
    throw new Error(
      'Chrome not found for browser benchmark. Install Google Chrome, set CHROME_BIN or GOOGLE_CHROME, or pass --chrome /path/to/chrome',
    );
  }
  const chromeProfile = createChromeLaunchProfile();
  const server = await startStaticServer(DEFAULT_BROWSER_PORT);
  const userDataDir = await mkdtemp(join(tmpdir(), 'wasml-llama-chrome-'));
  const browser = await puppeteer.launch({
    executablePath: chromeExecutablePath,
    headless: chromeProfile.headless,
    userDataDir,
    args: chromeProfile.args,
  });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.origin}/bench/browser/index.html`, { waitUntil: 'networkidle0' });
    const sample = await page.evaluate(async (injected) => {
          const result = await (window as unknown as { runWasmlBench: (config: unknown) => Promise<unknown> }).runWasmlBench(injected);
      return result;
    }, {
      commit,
      config,
    });
    const browserVersion = await browser.version();
    return {
      ...(sample as BenchSample),
      environmentDetails: createChromeEnvironmentDetails(browserVersion, chromeProfile),
    };
  } finally {
    await browser.close();
    await server.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
}
