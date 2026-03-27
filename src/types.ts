export type ManagedSignal = "SIGTERM" | "SIGKILL";
export type PressureLevel = "normal" | "elevated" | "critical";

export interface ProcessInfo {
  pid: number;
  ppid: number;
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

export interface ReportTimeSeriesSample {
  collectedAt: Date;
  memory: MemorySummary;
  processes: ProcessInfo[];
}

export interface ReportCollectionProgress {
  currentSample: number;
  totalSamples: number;
  elapsedMs: number;
  windowMs: number;
}

export interface ReportSnapshot extends Snapshot {
  diagnostics: ReportDiagnostics;
  samples: ReportTimeSeriesSample[];
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
