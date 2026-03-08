export type ManagedSignal = "SIGTERM" | "SIGKILL";
export type PressureLevel = "normal" | "elevated" | "critical";

export interface ProcessInfo {
  pid: number;
  uid: number;
  user: string;
  name: string;
  rssBytes: number;
  memoryPercent: number;
  cpuPercent: number;
}

export interface MemorySummary {
  pageSize: number;
  totalBytes: number;
  availableEstimateBytes: number;
  freeBytes: number;
  activeBytes: number;
  inactiveBytes: number;
  wiredBytes: number;
  compressedBytes: number;
  speculativeBytes: number;
  purgeableBytes: number;
  pageins: number;
  pageouts: number;
  swapins: number;
  swapouts: number;
  pressureLevel: PressureLevel;
}

export interface Snapshot {
  processes: ProcessInfo[];
  memory: MemorySummary;
  collectedAt: Date;
}

export interface ReportDiagnostics {
  windowMs: number;
  baselineCollectedAt: Date;
  pageinsDelta: number;
  pageoutsDelta: number;
  swapinsDelta: number;
  swapoutsDelta: number;
  pageinsPerSecond: number;
  pageoutsPerSecond: number;
  swapinsPerSecond: number;
  swapoutsPerSecond: number;
}

export interface ReportSnapshot extends Snapshot {
  diagnostics: ReportDiagnostics;
}

export interface ReportContext {
  hostname: string;
  platform: string;
  arch: string;
  commandVersion: string;
  generatedAt: Date;
}

export interface SnapshotReportWriteOptions {
  outputPath?: string;
  reportsDir?: string;
}
