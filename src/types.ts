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

