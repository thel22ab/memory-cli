import { createApp } from "./app";
import { collectReportSnapshot, writeSnapshotReport } from "./services/report";
import type { ReportSnapshot } from "./types";

export interface CliDependencies {
  createApp?: typeof createApp;
  collectReportSnapshot?: (options?: { diagnosticWindowMs?: number }) => Promise<ReportSnapshot>;
  stderr?: Pick<typeof process.stderr, "write">;
  stdout?: Pick<typeof process.stdout, "write">;
  writeSnapshotReport?: (snapshot: ReportSnapshot) => Promise<string>;
}

export async function runCli(args: string[], dependencies: CliDependencies = {}): Promise<number> {
  const createAppInstance = dependencies.createApp ?? createApp;
  const collectSnapshot = dependencies.collectReportSnapshot ?? collectReportSnapshot;
  const writeReport = dependencies.writeSnapshotReport ?? writeSnapshotReport;
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;

  if (args.length === 0) {
    const app = createAppInstance();

    try {
      await app.start();
      return 0;
    } catch (error) {
      app.stop();
      throw error;
    }
  }

  if (args[0] === "snapshot-report") {
    const windowMs = parseWindowMs(args.slice(1));

    if (windowMs === null) {
      stderr.write(`Usage: memory-cli [snapshot-report --window-seconds 30|60|120]\n`);
      return 1;
    }

    const snapshot = await collectSnapshot({ diagnosticWindowMs: windowMs });
    const reportPath = await writeReport(snapshot);
    stdout.write(`${reportPath}\n`);
    return 0;
  }

  stderr.write(`Usage: memory-cli [snapshot-report --window-seconds 30|60|120]\n`);
  return 1;
}

function parseWindowMs(args: string[]): number | null {
  if (args.length === 0) {
    return 30_000;
  }

  if (args.length === 2 && args[0] === "--window-seconds") {
    const value = Number(args[1]);
    return [30, 60, 120].includes(value) ? value * 1000 : null;
  }

  return null;
}
