import { createApp } from "./app";
import { collectReportSnapshot, writeSnapshotReport } from "./services/report";
import type { ReportSnapshot } from "./types";

export interface CliDependencies {
  createApp?: typeof createApp;
  collectReportSnapshot?: () => Promise<ReportSnapshot>;
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

  if (args.length === 1 && args[0] === "snapshot-report") {
    const snapshot = await collectSnapshot();
    const reportPath = await writeReport(snapshot);
    stdout.write(`${reportPath}\n`);
    return 0;
  }

  stderr.write(`Usage: memory-cli [snapshot-report]\n`);
  return 1;
}
