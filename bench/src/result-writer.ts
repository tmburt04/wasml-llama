    import { mkdir, readFile, writeFile } from 'node:fs/promises';
    import { resolve } from 'node:path';
    import type { BenchReport, BenchSample, BenchThresholds } from './types.js';

    export function evaluateRegressions(current: BenchSample[], baseline: BenchSample[], thresholds: BenchThresholds): string[] {
  const baselineByKey = new Map(baseline.map((sample) => [sampleKey(sample), sample]));
      const regressions: string[] = [];
      for (const sample of current) {
    const key = sampleKey(sample);
        const previous = baselineByKey.get(key);
        if (!previous) {
          continue;
        }
        const startupDelta = pctChange(sample.metrics.startupLatencyMs, previous.metrics.startupLatencyMs);
        const throughputDelta = pctDrop(sample.metrics.tokensPerSecond, previous.metrics.tokensPerSecond);
        const memoryDelta = pctChange(sample.metrics.peakMemoryBytes, previous.metrics.peakMemoryBytes);
        if (startupDelta > thresholds.startupLatencyPct) {
          regressions.push(`${key}: startup latency regression ${startupDelta.toFixed(2)}%`);
        }
        if (throughputDelta > thresholds.decodeTokensPerSecondPct) {
          regressions.push(`${key}: decode throughput regression ${throughputDelta.toFixed(2)}%`);
        }
        if (memoryDelta > thresholds.peakMemoryPct) {
          regressions.push(`${key}: memory regression ${memoryDelta.toFixed(2)}%`);
        }
      }
      return regressions;
    }

function sampleKey(sample: BenchSample): string {
  return `${sample.environment}:${sample.backend}:${sample.environmentDetails?.compatibilityKey ?? 'legacy'}`;
}

    export async function writeBenchReport(commit: string, report: BenchReport): Promise<string> {
      const directory = resolve(process.cwd(), 'bench', 'results');
      await mkdir(directory, { recursive: true });
      const path = resolve(directory, `${commit}.json`);
      await writeFile(path, `${JSON.stringify(report, null, 2)}
`, 'utf8');
      return path;
    }

    export async function readBaseline(path: string | undefined): Promise<BenchSample[]> {
      if (!path) {
        return [];
      }
      const report = JSON.parse(await readFile(path, 'utf8')) as BenchReport;
      return report.samples;
    }

    function pctChange(current: number, previous: number): number {
      if (previous === 0) {
        return 0;
      }
      return ((current - previous) / previous) * 100;
    }

    function pctDrop(current: number, previous: number): number {
      if (previous === 0) {
        return 0;
      }
      return ((previous - current) / previous) * 100;
    }
