import { describe, expect, mock, test } from "bun:test";

import { runCli } from "../src/cli";
import type { App } from "../src/app";
import type { ReportSnapshot } from "../src/types";

const snapshot: ReportSnapshot = {
  processes: [],
  memory: {
    pageSize: 16384,
    totalBytes: 1,
    availableEstimateBytes: 1,
    freeBytes: 0,
    activeBytes: 0,
    inactiveBytes: 0,
    wiredBytes: 0,
    compressedBytes: 0,
    speculativeBytes: 0,
    purgeableBytes: 0,
    pageins: 0,
    pageouts: 0,
    swapins: 0,
    swapouts: 0,
    pressureLevel: "normal"
  },
  collectedAt: new Date("2026-03-08T12:00:00.000Z"),
  diagnostics: {
    windowMs: 10_000,
    baselineCollectedAt: new Date("2026-03-08T11:59:50.000Z"),
    pageinsDelta: 0,
    pageoutsDelta: 0,
    swapinsDelta: 0,
    swapoutsDelta: 0,
    pageinsPerSecond: 0,
    pageoutsPerSecond: 0,
    swapinsPerSecond: 0,
    swapoutsPerSecond: 0
  }
};

describe("runCli", () => {
  test("launches the dashboard when no subcommand is provided", async () => {
    const start = mock(async () => undefined);
    const stop = mock(() => undefined);

    const exitCode = await runCli([], {
      createApp: () =>
        ({
          start,
          stop
        }) satisfies App
    });

    expect(exitCode).toBe(0);
    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
  });

  test("writes a snapshot report and prints the path", async () => {
    const stdout = { write: mock(() => true) };
    const collectReportSnapshot = mock(async () => snapshot);
    const writeSnapshotReport = mock(async () => "/tmp/report.md");

    const exitCode = await runCli(["snapshot-report"], {
      stdout,
      collectReportSnapshot,
      writeSnapshotReport
    });

    expect(exitCode).toBe(0);
    expect(collectReportSnapshot).toHaveBeenCalledTimes(1);
    expect(writeSnapshotReport).toHaveBeenCalledWith(snapshot);
    expect(stdout.write).toHaveBeenCalledWith("/tmp/report.md\n");
  });

  test("prints usage for unknown subcommands", async () => {
    const stderr = { write: mock(() => true) };

    const exitCode = await runCli(["wat"], { stderr });

    expect(exitCode).toBe(1);
    expect(stderr.write).toHaveBeenCalledWith("Usage: memory-cli [snapshot-report]\n");
  });
});
