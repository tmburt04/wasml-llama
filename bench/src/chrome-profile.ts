import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { arch, platform, release } from 'node:os';
import { join } from 'node:path';

import type { BenchEnvironmentDetails } from './types.js';

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves a Chrome/Chromium binary for Puppeteer: optional CLI path, then
 * `CHROME_BIN` / `GOOGLE_CHROME`, then common install locations per OS.
 */
export async function resolveChromeExecutablePath(cliPath?: string): Promise<string | undefined> {
  const candidates: string[] = [];
  const add = (value: string | undefined) => {
    const trimmed = value?.trim();
    if (trimmed && !candidates.includes(trimmed)) {
      candidates.push(trimmed);
    }
  };
  add(cliPath);
  add(process.env.CHROME_BIN);
  add(process.env.GOOGLE_CHROME);

  const plat = platform();
  if (plat === 'darwin') {
    add('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    add('/Applications/Chromium.app/Contents/MacOS/Chromium');
  } else if (plat === 'linux') {
    add('/usr/bin/google-chrome-stable');
    add('/usr/bin/google-chrome');
    add('/usr/bin/chromium-browser');
    add('/usr/bin/chromium');
    add('/snap/bin/chromium');
  } else if (plat === 'win32') {
    const programFiles = process.env.PROGRAMFILES;
    const programFilesX86 = process.env['PROGRAMFILES(X86)'];
    const localAppData = process.env.LOCALAPPDATA;
    if (programFiles) {
      add(join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    }
    if (programFilesX86) {
      add(join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    }
    if (localAppData) {
      add(join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    }
  }

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

const REQUIRED_CHROME_ARGS = [
  '--enable-unsafe-webgpu',
  '--enable-features=WebGPU,WebAssemblyExperimentalJSPI',
  '--disable-gpu-sandbox',
  '--no-sandbox',
] as const;

export interface ChromeLaunchProfile {
  readonly args: string[];
  readonly flagHash: string;
  readonly headless: boolean;
  readonly os: string;
}

export function createChromeLaunchProfile(): ChromeLaunchProfile {
  const extraArgs = (process.env.CHROME_EXTRA_ARGS ?? '')
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
  const args = [...REQUIRED_CHROME_ARGS, ...extraArgs];
  return {
    args,
    flagHash: createHash('sha256').update(args.join('\n')).digest('hex').slice(0, 12),
    headless: true,
    os: `${platform()}-${release()}-${arch()}`,
  };
}

export function createChromeEnvironmentDetails(
  browserVersion: string,
  profile: ChromeLaunchProfile,
): BenchEnvironmentDetails {
  return {
    compatibilityKey: `chrome:${browserVersion}:${profile.flagHash}:${profile.headless ? 'headless' : 'headed'}`,
    browserVersion,
    flagHash: profile.flagHash,
    flags: profile.args,
    headless: profile.headless,
    os: profile.os,
    platform: platform(),
  };
}
