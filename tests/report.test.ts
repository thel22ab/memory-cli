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

const baselineProcesses = [
  {
    pid: 100,
    ppid: 1,
    uid: 501,
    user: "thoger",
    name: "Browser",
    rssBytes: 300 * 1024 * 1024,
    memoryPercent: 3.0,
    cpuPercent: 1.0
  },
  {
    pid: 101,
    ppid: 100,
    uid: 501,
    user: "thoger",
    name: "Browser Helper (Renderer)",
    rssBytes: 120 * 1024 * 1024,
    memoryPercent: 1.2,
    cpuPercent: 2.0
  },
  {
    pid: 102,
    ppid: 100,
    uid: 501,
    user: "thoger",
    name: "Browser Helper (GPU)",
    rssBytes: 90 * 1024 * 1024,
    memoryPercent: 0.9,
    cpuPercent: 1.5
  },
  {
    pid: 200,
    ppid: 1,
    uid: 501,
    user: "thoger",
    name: "T3 Code",
    rssBytes: 250 * 1024 * 1024,
    memoryPercent: 2.5,
    cpuPercent: 1.0
  },
  {
    pid: 201,
    ppid: 200,
    uid: 501,
    user: "thoger",
    name: "T3 Code Helper (Renderer)",
    rssBytes: 110 * 1024 * 1024,
    memoryPercent: 1.1,
    cpuPercent: 1.4
  }
];

const finalProcesses = [
  {
    ...baselineProcesses[0],
    rssBytes: 420 * 1024 * 1024
  },
  {
    ...baselineProcesses[1],
    rssBytes: 240 * 1024 * 1024
  },
  {
    ...baselineProcesses[2],
    rssBytes: 120 * 1024 * 1024
  },
  {
    ...baselineProcesses[3],
    rssBytes: 280 * 1024 * 1024
  },
  {
    ...baselineProcesses[4],
    rssBytes: 150 * 1024 * 1024
  },
  ...Array.from({ length: 55 }, (_, index) => ({
    pid: 300 + index,
    ppid: 1,
    uid: 501,
    user: index % 2 === 0 ? "thoger" : "root|ops",
    name: `Process ${index + 1}`,
    rssBytes: (60 - index) * 2 * 1024 * 1024,
    memoryPercent: 1.0,
    cpuPercent: 0.5
  }))
];

const baselineMemory = {
  pageSize: 16384,
  totalBytes: 16 * 1024 * 1024 * 1024,
  availableEstimateBytes: Math.floor(2.1 * 1024 * 1024 * 1024),
  freeBytes: 512 * 1024 * 1024,
  activeBytes: Math.floor(1.0 * 1024 * 1024 * 1024),
  inactiveBytes: Math.floor(1.3 * 1024 * 1024 * 1024),
  wiredBytes: Math.floor(1.5 * 1024 * 1024 * 1024),
  compressedBytes: Math.floor(2.2 * 1024 * 1024 * 1024),
  speculativeBytes: 256 * 1024 * 1024,
  purgeableBytes: 128 * 1024 * 1024,
  pageins: 880,
  pageouts: 755,
  swapins: 208,
  swapouts: 113,
  pressureLevel: "elevated" as const
};

const middleMemory = {
  ...baselineMemory,
  availableEstimateBytes: Math.floor(1.8 * 1024 * 1024 * 1024),
  freeBytes: 256 * 1024 * 1024,
  wiredBytes: Math.floor(1.6 * 1024 * 1024 * 1024),
  compressedBytes: Math.floor(2.7 * 1024 * 1024 * 1024),
  pageins: 940,
  pageouts: 780,
  swapins: 215,
  swapouts: 118,
  pressureLevel: "critical" as const
};

const finalMemory = {
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
  pressureLevel: "critical" as const
};

const reportSnapshot: ReportSnapshot = {
  processes: finalProcesses,
  memory: finalMemory,
  collectedAt: new Date("2026-03-08T12:34:56.000Z"),
  diagnostics: {
    windowMs: 30_000,
    baselineCollectedAt: new Date("2026-03-08T12:34:26.000Z"),
    pageinsDelta: 120,
    pageoutsDelta: 45,
    swapinsDelta: 12,
    swapoutsDelta: 7,
    pageinsPerSecond: 4,
    pageoutsPerSecond: 1.5,
    swapinsPerSecond: 0.4,
    swapoutsPerSecond: 0.23
  },
  samples: [
    {
      collectedAt: new Date("2026-03-08T12:34:26.000Z"),
      memory: baselineMemory,
      processes: baselineProcesses
    },
    {
      collectedAt: new Date("2026-03-08T12:34:36.000Z"),
      memory: middleMemory,
      processes: finalProcesses.slice(0, 20)
    },
    {
      collectedAt: new Date("2026-03-08T12:34:56.000Z"),
      memory: finalMemory,
      processes: finalProcesses
    }
  ]
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
  test("captures a time series over the configured window", async () => {
    const fetchMemory = mock(async () => reportSnapshot.memory);
    const fetchProcessList = mock(async () => finalProcesses);
    const sleep = mock(async () => undefined);

    const snapshot = await collectReportSnapshot({
      diagnosticWindowMs: 30_000,
      sampleIntervalMs: 10_000,
      fetchMemory,
      fetchProcessList,
      sleep
    });

    expect(fetchProcessList).toHaveBeenCalledTimes(4);
    expect(snapshot.samples).toHaveLength(4);
    expect(snapshot.processes).toHaveLength(finalProcesses.length);
  });
});

describe("formatSnapshotReport", () => {
  test("renders time series, growth sorting, app-tree grouping, and explicit gap breakdown", () => {
    const report = formatSnapshotReport(reportSnapshot, {
      hostname: "my-macbook.local",
      platform: "darwin",
      arch: "arm64",
      commandVersion: "0.1.0",
      generatedAt: new Date("2026-03-08T12:34:56.000Z")
    });

    expect(report).toContain("# Memory Snapshot Report");
    expect(report).toContain("tracked 3 samples over 30.0 s");
    expect(report).toContain("Gap Breakdown: Compressed");
    expect(report).toContain("Gap Breakdown: Wired");
    expect(report).toContain("Gap Breakdown: Inactive");
    expect(report).toContain("Gap Breakdown: Other/System");
    expect(report).toContain("## Time Series");
    expect(report).toContain("| Sample | Timestamp | Visible Processes | Visible RSS | Pressure | Free | Compressed |");
    expect(report).toContain("## App Trees By Growth");
    expect(report).toContain("| Browser | 3 |");
    expect(report).toContain("+270 MiB");
    expect(report).toContain("## Processes By Growth");
    expect(report).toContain("| 101 | thoger | 240 MiB | +120 MiB |");
    expect(report).toContain("tree=\"Browser\"");
    expect(report).toContain("sampleCount=3");
    expect(report).toContain("otherSystemBytes=");
    expect(report).toContain("During the last 30.0 s, the system recorded active outward memory pressure");
    expect(report).not.toContain("| 354 |");
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
      samples: [
        {
          collectedAt: new Date("2026-03-08T12:34:26.000Z"),
          memory: reportSnapshot.memory,
          processes: []
        },
        {
          collectedAt: new Date("2026-03-08T12:34:56.000Z"),
          memory: reportSnapshot.memory,
          processes: []
        }
      ]
    });

    expect(report).toContain("| No grouped app trees available | 0 | 0 B | 0 B | 0.0% | - |");
    expect(report).toContain("| - | - | 0 B | 0 B | 0.0 | 0.0 | No processes returned by ps. |");
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
    expect(written).toContain("## Time Series");
    expect(written).toContain("## App Trees By Growth");
  });
});
