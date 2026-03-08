import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  collectReportSnapshot,
  formatSnapshotReport,
  getDefaultReportsDir,
  resolveSnapshotReportPath,
  writeSnapshotReport
} from "../src/services/report";
import type { ReportSnapshot } from "../src/types";

const reportSnapshot: ReportSnapshot = {
  processes: Array.from({ length: 60 }, (_, index) => ({
    pid: 500 + index,
    uid: 501,
    user: index % 2 === 0 ? "thoger" : "root|ops",
    name:
      index < 4
        ? `Browser Helper (${["Renderer", "Renderer", "GPU", "Utility"][index]})`
        : index === 4
          ? "T3 Code Helper (Renderer)"
          : `Process ${index + 1}`,
    rssBytes: (60 - index) * 32 * 1024 * 1024,
    memoryPercent: 8 - index * 0.1,
    cpuPercent: index * 0.2
  })),
  memory: {
    pageSize: 16384,
    totalBytes: 16 * 1024 * 1024 * 1024,
    availableEstimateBytes: Math.floor(1.3 * 1024 * 1024 * 1024),
    freeBytes: 58 * 1024 * 1024,
    activeBytes: Math.floor(1.3 * 1024 * 1024 * 1024),
    inactiveBytes: Math.floor(1.1 * 1024 * 1024 * 1024),
    wiredBytes: Math.floor(1.7 * 1024 * 1024 * 1024),
    compressedBytes: Math.floor(3.1 * 1024 * 1024 * 1024),
    speculativeBytes: 256 * 1024 * 1024,
    purgeableBytes: 128 * 1024 * 1024,
    pageins: 1_000,
    pageouts: 800,
    swapins: 220,
    swapouts: 120,
    pressureLevel: "critical"
  },
  collectedAt: new Date("2026-03-08T12:34:56.000Z"),
  diagnostics: {
    windowMs: 10_000,
    baselineCollectedAt: new Date("2026-03-08T12:34:46.000Z"),
    pageinsDelta: 120,
    pageoutsDelta: 45,
    swapinsDelta: 12,
    swapoutsDelta: 7,
    pageinsPerSecond: 12,
    pageoutsPerSecond: 4.5,
    swapinsPerSecond: 1.2,
    swapoutsPerSecond: 0.7
  }
};

let tempDirectory: string | null = null;

afterEach(async () => {
  mock.restore();

  if (tempDirectory) {
    await rm(tempDirectory, { force: true, recursive: true });
    tempDirectory = null;
  }
});

describe("collectReportSnapshot", () => {
  test("captures all processes and paging deltas across a diagnostic window", async () => {
    const memorySamples = [
      {
        ...reportSnapshot.memory,
        pageins: 100,
        pageouts: 20,
        swapins: 5,
        swapouts: 1
      },
      {
        ...reportSnapshot.memory,
        pageins: 130,
        pageouts: 28,
        swapins: 7,
        swapouts: 4
      }
    ];
    const fetchMemory = mock(async () => memorySamples.shift() ?? reportSnapshot.memory);
    const fetchProcessList = mock(async () => reportSnapshot.processes);
    const sleep = mock(async () => undefined);

    const snapshot = await collectReportSnapshot({
      diagnosticWindowMs: 10_000,
      fetchMemory,
      fetchProcessList,
      sleep
    });

    expect(fetchProcessList).toHaveBeenCalledTimes(1);
    expect(snapshot.processes).toHaveLength(60);
    expect(snapshot.diagnostics.pageinsDelta).toBe(30);
    expect(snapshot.diagnostics.pageoutsDelta).toBe(8);
    expect(snapshot.diagnostics.swapoutsDelta).toBe(3);
  });
});

describe("formatSnapshotReport", () => {
  test("renders accounting, grouped families, diagnostics, and a wider top-process view", () => {
    const report = formatSnapshotReport(reportSnapshot, {
      hostname: "my-macbook.local",
      platform: "darwin",
      arch: "arm64",
      commandVersion: "0.1.0",
      generatedAt: new Date("2026-03-08T12:34:56.000Z")
    });

    expect(report).toContain("# Memory Snapshot Report");
    expect(report).toContain("Memory pressure is CRITICAL.");
    expect(report).toContain("compressed memory is 3.1 GiB");
    expect(report).toContain("wired memory is 1.7 GiB");
    expect(report).toContain("The report captured 60 visible processes");
    expect(report).toContain("## Memory Accounting");
    expect(report).toContain("Sum RSS Across Visible Processes");
    expect(report).toContain("Unexplained vs Visible Process RSS");
    expect(report).toContain("## Aggregated Process Families");
    expect(report).toContain("| Browser | 4 |");
    expect(report).toContain("Browser Helper (Renderer), Browser Helper (GPU), Browser Helper (Utility)");
    expect(report).toContain("## Pressure Diagnostics");
    expect(report).toContain("| Pageouts Delta | 45 (4.50/sec) |");
    expect(report).toContain("| Swapouts Delta | 7 (0.70/sec) |");
    expect(report).toContain("During the last 10.0 s, the system recorded active outward memory pressure");
    expect(report).toContain("## Top Processes (Top 50 of 60)");
    expect(report).toContain('family="Browser"');
    expect(report).not.toContain("Process 60 |");
    expect(report).toContain("visibleProcessCount=60");
    expect(report).toContain("unexplainedBytes=");
  });

  test("handles empty process lists gracefully", () => {
    const report = formatSnapshotReport({
      ...reportSnapshot,
      processes: [],
      diagnostics: {
        ...reportSnapshot.diagnostics,
        pageinsDelta: 0,
        pageoutsDelta: 0,
        swapinsDelta: 0,
        swapoutsDelta: 0,
        pageinsPerSecond: 0,
        pageoutsPerSecond: 0,
        swapinsPerSecond: 0,
        swapoutsPerSecond: 0
      },
      memory: {
        ...reportSnapshot.memory,
        pageins: 0,
        pageouts: 0,
        swapins: 0,
        swapouts: 0,
        pressureLevel: "normal"
      }
    });

    expect(report).toContain("No process data was returned by ps.");
    expect(report).toContain("| No grouped process families available | 0 | 0 B | 0.0% | - |");
    expect(report).toContain("pageout and swap activity stayed flat");
    expect(report).toContain("no-processes");
  });
});

describe("report paths", () => {
  test("resolves the default reports directory under Downloads", () => {
    expect(getDefaultReportsDir("/Users/example")).toBe("/Users/example/Downloads/memory-reports");
  });

  test("builds a timestamped markdown path", () => {
    const reportPath = resolveSnapshotReportPath({ reportsDir: "/tmp/reports" }, new Date("2026-03-08T12:34:56.000Z"));

    expect(reportPath).toBe(path.resolve("/tmp/reports/memory-report-2026-03-08-12-34-56.md"));
  });

  test("fails clearly when the home directory is unavailable", () => {
    expect(() => getDefaultReportsDir("")).toThrow(
      "Failed to resolve snapshot report path: home directory is unavailable."
    );
  });
});

describe("writeSnapshotReport", () => {
  test("creates the report directory and writes the markdown file", async () => {
    tempDirectory = await mkdtemp(path.join(os.tmpdir(), "memory-cli-report-"));
    const reportsDir = path.join(tempDirectory, "nested", "reports");

    const reportPath = await writeSnapshotReport(reportSnapshot, { reportsDir });
    const written = await readFile(reportPath, "utf8");

    expect(reportPath).toBe(path.join(reportsDir, "memory-report-2026-03-08-12-34-56.md"));
    expect(written).toContain("# Memory Snapshot Report");
    expect(written).toContain("## Pressure Diagnostics");
    expect(written).toContain("## Aggregated Process Families");
  });
});
