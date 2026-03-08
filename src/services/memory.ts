import os from "node:os";

import type { MemorySummary, PressureLevel } from "../types";
import { runCommand } from "./command";

export function parseVmStatOutput(output: string, totalBytes = os.totalmem()): MemorySummary {
  const pageSize = Number(output.match(/page size of (\d+) bytes/i)?.[1] ?? "4096");
  const stats = parseStats(output);

  const freeBytes = toBytes(stats["Pages free"], pageSize);
  const activeBytes = toBytes(stats["Pages active"], pageSize);
  const inactiveBytes = toBytes(stats["Pages inactive"], pageSize);
  const speculativeBytes = toBytes(stats["Pages speculative"], pageSize);
  const wiredBytes = toBytes(stats["Pages wired down"], pageSize);
  const compressedBytes = toBytes(stats["Pages occupied by compressor"], pageSize);
  const purgeableBytes = toBytes(stats["Pages purgeable"], pageSize);
  const availableEstimateBytes = freeBytes + inactiveBytes + speculativeBytes + purgeableBytes;

  return {
    pageSize,
    totalBytes,
    availableEstimateBytes,
    freeBytes,
    activeBytes,
    inactiveBytes,
    wiredBytes,
    compressedBytes,
    speculativeBytes,
    purgeableBytes,
    pageins: stats.Pageins ?? 0,
    pageouts: stats.Pageouts ?? 0,
    swapins: stats.Swapins ?? 0,
    swapouts: stats.Swapouts ?? 0,
    pressureLevel: getPressureLevel(totalBytes, availableEstimateBytes, compressedBytes)
  };
}

export async function fetchMemorySummary(): Promise<MemorySummary> {
  const output = await runCommand("vm_stat", []);
  return parseVmStatOutput(output);
}

function parseStats(output: string): Record<string, number> {
  const stats: Record<string, number> = {};

  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^"?([^":]+)"?:\s+(\d+)\./);

    if (!match) {
      continue;
    }

    stats[match[1]] = Number(match[2]);
  }

  return stats;
}

function toBytes(pages: number | undefined, pageSize: number): number {
  return (pages ?? 0) * pageSize;
}

function getPressureLevel(
  totalBytes: number,
  availableEstimateBytes: number,
  compressedBytes: number
): PressureLevel {
  const availableRatio = totalBytes > 0 ? availableEstimateBytes / totalBytes : 1;
  const compressedRatio = totalBytes > 0 ? compressedBytes / totalBytes : 0;

  if (availableRatio < 0.08 || compressedRatio > 0.2) {
    return "critical";
  }

  if (availableRatio < 0.18 || compressedRatio > 0.1) {
    return "elevated";
  }

  return "normal";
}

