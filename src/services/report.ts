import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { fetchMemorySummary } from "./memory";
import { fetchProcesses } from "./processes";
import type {
  MemorySummary,
  ProcessInfo,
  ReportCollectionProgress,
  ReportContext,
  ReportSnapshot,
  ReportTimeSeriesSample,
  SnapshotReportWriteOptions
} from "../types";
import { formatBytes, formatCount, formatPressure, formatRatio } from "../ui/format";

const DEFAULT_TOP_PROCESS_LIMIT = 50;
const DEFAULT_GROUP_LIMIT = 15;
const DEFAULT_REPORTS_DIR_NAME = "memory-reports";
const DEFAULT_REPORT_FILE_PREFIX = "memory-report-";
const DEFAULT_DIAGNOSTIC_WINDOW_MS = 30_000;
const DEFAULT_SAMPLE_INTERVAL_MS = 10_000;
const TOOL_NAME = "memory-cli";
const TOOL_VERSION = process.env.npm_package_version ?? "0.1.0";

export interface CollectReportSnapshotOptions {
  diagnosticWindowMs?: number;
  sampleIntervalMs?: number;
  fetchMemory?: () => Promise<MemorySummary>;
  fetchProcessList?: () => Promise<ProcessInfo[]>;
  onProgress?: (progress: ReportCollectionProgress) => void;
  sleep?: (ms: number) => Promise<void>;
}

interface ProcessGroupSummary {
  key: string;
  processCount: number;
  currentRssBytes: number;
  deltaRssBytes: number;
  topMembers: string[];
}

interface ProcessGrowthSummary {
  pid: number;
  user: string;
  name: string;
  currentRssBytes: number;
  deltaRssBytes: number;
  memoryPercent: number;
  cpuPercent: number;
}

interface AccountingSummary {
  totalProcessCount: number;
  visibleProcessRssBytes: number;
  topProcessRssBytes: number;
  visibleProcessRatio: number;
  topProcessRatio: number;
  gapBytes: number;
  gapRatio: number;
  otherSystemBytes: number;
}

export async function collectReportSnapshot(
  options: CollectReportSnapshotOptions = {}
): Promise<ReportSnapshot> {
  const diagnosticWindowMs = clampWindow(options.diagnosticWindowMs ?? DEFAULT_DIAGNOSTIC_WINDOW_MS);
  const sampleIntervalMs = Math.max(1_000, options.sampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS);
  const fetchMemory = options.fetchMemory ?? fetchMemorySummary;
  const fetchProcessList = options.fetchProcessList ?? fetchProcesses;
  const sleep = options.sleep ?? defaultSleep;
  const totalSamples = Math.max(2, Math.floor(diagnosticWindowMs / sampleIntervalMs) + 1);
  const samples: ReportTimeSeriesSample[] = [];

  for (let sampleIndex = 0; sampleIndex < totalSamples; sampleIndex += 1) {
    options.onProgress?.({
      currentSample: sampleIndex + 1,
      totalSamples,
      elapsedMs: sampleIndex * sampleIntervalMs,
      windowMs: diagnosticWindowMs
    });

    const [processes, memory] = await Promise.all([fetchProcessList(), fetchMemory()]);
    samples.push({
      collectedAt: new Date(),
      memory,
      processes
    });

    const hasNextSample = sampleIndex < totalSamples - 1;
    if (hasNextSample) {
      await sleep(sampleIntervalMs);
    }
  }

  const firstSample = samples[0];
  const lastSample = samples.at(-1);

  if (!firstSample || !lastSample) {
    throw new Error("Failed to collect snapshot report samples.");
  }

  return {
    processes: lastSample.processes,
    memory: lastSample.memory,
    collectedAt: lastSample.collectedAt,
    samples,
    diagnostics: buildDiagnostics(firstSample.memory, lastSample.memory, firstSample.collectedAt, lastSample.collectedAt)
  };
}

export function formatSnapshotReport(
  snapshot: ReportSnapshot,
  context = getDefaultReportContext(snapshot)
): string {
  const topProcessGrowth = summarizeProcessGrowth(snapshot.samples).slice(0, DEFAULT_TOP_PROCESS_LIMIT);
  const topGroups = summarizeAppGroups(snapshot.samples).slice(0, DEFAULT_GROUP_LIMIT);
  const availableRatio = getRatio(snapshot.memory.availableEstimateBytes, snapshot.memory.totalBytes);
  const compressedRatio = getRatio(snapshot.memory.compressedBytes, snapshot.memory.totalBytes);
  const accounting = buildAccountingSummary(snapshot, topProcessGrowth.length);

  return [
    "# Memory Snapshot Report",
    "",
    `Generated: ${formatLocalTimestamp(context.generatedAt)} local time`,
    `Host: ${context.hostname}`,
    `Platform: ${context.platform} ${context.arch}`,
    `Tool: ${TOOL_NAME} ${context.commandVersion}`,
    "",
    "## Executive Summary",
    "",
    buildExecutiveSummary(snapshot, topProcessGrowth, topGroups, accounting, availableRatio, compressedRatio),
    "",
    "## Memory Overview",
    "",
    "| Metric | Value |",
    "| --- | --- |",
    `| Pressure | ${formatPressure(snapshot.memory.pressureLevel)} |`,
    `| Total | ${formatBytes(snapshot.memory.totalBytes)} |`,
    `| Available Estimate | ${formatBytes(snapshot.memory.availableEstimateBytes)} (${formatRatio(availableRatio)}) |`,
    `| Free | ${formatBytes(snapshot.memory.freeBytes)} |`,
    `| Active | ${formatBytes(snapshot.memory.activeBytes)} |`,
    `| Inactive | ${formatBytes(snapshot.memory.inactiveBytes)} |`,
    `| Wired | ${formatBytes(snapshot.memory.wiredBytes)} |`,
    `| Compressed | ${formatBytes(snapshot.memory.compressedBytes)} (${formatRatio(compressedRatio)}) |`,
    `| Speculative | ${formatBytes(snapshot.memory.speculativeBytes)} |`,
    `| Purgeable | ${formatBytes(snapshot.memory.purgeableBytes)} |`,
    `| Pageins | ${formatCount(snapshot.memory.pageins)} |`,
    `| Pageouts | ${formatCount(snapshot.memory.pageouts)} |`,
    `| Swapins | ${formatCount(snapshot.memory.swapins)} |`,
    `| Swapouts | ${formatCount(snapshot.memory.swapouts)} |`,
    "",
    "## Memory Accounting",
    "",
    "| Metric | Value |",
    "| --- | --- |",
    `| Visible Processes | ${formatCount(accounting.totalProcessCount)} |`,
    `| Sum RSS Across Visible Processes | ${formatBytes(accounting.visibleProcessRssBytes)} (${formatRatio(
      accounting.visibleProcessRatio
    )} of physical RAM) |`,
    `| Sum RSS Across Top ${topProcessGrowth.length} Growth-Tracked Processes | ${formatBytes(accounting.topProcessRssBytes)} (${formatRatio(
      accounting.topProcessRatio
    )} of physical RAM) |`,
    `| Gap vs Physical RAM | ${formatBytes(accounting.gapBytes)} (${formatRatio(accounting.gapRatio)} of physical RAM) |`,
    `| Gap Breakdown: Compressed | ${formatBytes(snapshot.memory.compressedBytes)} |`,
    `| Gap Breakdown: Wired | ${formatBytes(snapshot.memory.wiredBytes)} |`,
    `| Gap Breakdown: Inactive | ${formatBytes(snapshot.memory.inactiveBytes)} |`,
    `| Gap Breakdown: Other/System | ${formatBytes(accounting.otherSystemBytes)} |`,
    "",
    "The gap breakdown is heuristic: compressed, wired, inactive, and other/system are shown explicitly so the report makes the non-process side of pressure visible, even though RSS and physical memory are not 1:1 accounting categories.",
    "",
    "## Time Series",
    "",
    "| Sample | Timestamp | Visible Processes | Visible RSS | Pressure | Free | Compressed |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...snapshot.samples.map(
      (sample, index) =>
        `| ${index + 1} | ${formatLocalTimestamp(sample.collectedAt)} | ${formatCount(sample.processes.length)} | ${formatBytes(
          sumProcessRss(sample.processes)
        )} | ${formatPressure(sample.memory.pressureLevel)} | ${formatBytes(sample.memory.freeBytes)} | ${formatBytes(
          sample.memory.compressedBytes
        )} |`
    ),
    "",
    "## App Trees By Growth",
    "",
    "| App Tree | Processes | Current RSS | Delta RSS | Share of RAM | Example Members |",
    "| --- | --- | --- | --- | --- | --- |",
    ...(topGroups.length > 0
      ? topGroups.map(
          (group) =>
            `| ${escapeMarkdown(group.key)} | ${formatCount(group.processCount)} | ${formatBytes(
              group.currentRssBytes
            )} | ${formatSignedBytes(group.deltaRssBytes)} | ${formatRatio(
              getRatio(group.currentRssBytes, snapshot.memory.totalBytes)
            )} | ${escapeMarkdown(group.topMembers.join(", "))} |`
        )
      : ["| No grouped app trees available | 0 | 0 B | 0 B | 0.0% | - |"]),
    "",
    "## Processes By Growth",
    "",
    "| PID | USER | RSS | Delta RSS | %MEM | %CPU | NAME |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...(topProcessGrowth.length > 0
      ? topProcessGrowth.map(
          (processInfo) =>
            `| ${processInfo.pid} | ${escapeMarkdown(processInfo.user)} | ${formatBytes(
              processInfo.currentRssBytes
            )} | ${formatSignedBytes(processInfo.deltaRssBytes)} | ${processInfo.memoryPercent.toFixed(
              1
            )} | ${processInfo.cpuPercent.toFixed(1)} | ${escapeMarkdown(processInfo.name)} |`
        )
      : ["| - | - | 0 B | 0 B | 0.0 | 0.0 | No processes returned by ps. |"]),
    "",
    "## Pressure Diagnostics",
    "",
    "| Metric | Value |",
    "| --- | --- |",
    `| Diagnostic Window | ${formatDuration(snapshot.diagnostics.windowMs)} |`,
    `| Sample Count | ${formatCount(snapshot.samples.length)} |`,
    `| Pageins Delta | ${formatCount(snapshot.diagnostics.pageinsDelta)} (${formatRate(snapshot.diagnostics.pageinsPerSecond)}) |`,
    `| Pageouts Delta | ${formatCount(snapshot.diagnostics.pageoutsDelta)} (${formatRate(snapshot.diagnostics.pageoutsPerSecond)}) |`,
    `| Swapins Delta | ${formatCount(snapshot.diagnostics.swapinsDelta)} (${formatRate(snapshot.diagnostics.swapinsPerSecond)}) |`,
    `| Swapouts Delta | ${formatCount(snapshot.diagnostics.swapoutsDelta)} (${formatRate(snapshot.diagnostics.swapoutsPerSecond)}) |`,
    "",
    describeDiagnosticWindow(snapshot.diagnostics),
    "",
    "## Raw Memory Counters",
    "",
    "```text",
    `pageSize=${snapshot.memory.pageSize}`,
    `totalBytes=${snapshot.memory.totalBytes}`,
    `availableEstimateBytes=${snapshot.memory.availableEstimateBytes}`,
    `freeBytes=${snapshot.memory.freeBytes}`,
    `activeBytes=${snapshot.memory.activeBytes}`,
    `inactiveBytes=${snapshot.memory.inactiveBytes}`,
    `wiredBytes=${snapshot.memory.wiredBytes}`,
    `compressedBytes=${snapshot.memory.compressedBytes}`,
    `speculativeBytes=${snapshot.memory.speculativeBytes}`,
    `purgeableBytes=${snapshot.memory.purgeableBytes}`,
    `pageins=${snapshot.memory.pageins}`,
    `pageouts=${snapshot.memory.pageouts}`,
    `swapins=${snapshot.memory.swapins}`,
    `swapouts=${snapshot.memory.swapouts}`,
    `pressureLevel=${snapshot.memory.pressureLevel}`,
    `visibleProcessCount=${accounting.totalProcessCount}`,
    `visibleProcessRssBytes=${accounting.visibleProcessRssBytes}`,
    `gapBytes=${accounting.gapBytes}`,
    `otherSystemBytes=${accounting.otherSystemBytes}`,
    `windowMs=${snapshot.diagnostics.windowMs}`,
    `sampleCount=${snapshot.samples.length}`,
    `pageinsDelta=${snapshot.diagnostics.pageinsDelta}`,
    `pageoutsDelta=${snapshot.diagnostics.pageoutsDelta}`,
    `swapinsDelta=${snapshot.diagnostics.swapinsDelta}`,
    `swapoutsDelta=${snapshot.diagnostics.swapoutsDelta}`,
    "```",
    "",
    "## Raw Process Data",
    "",
    "```text",
    ...(snapshot.processes.length > 0
      ? snapshot.processes.map((processInfo) => {
          const deltaSummary = findProcessDelta(snapshot.samples, processInfo.pid);
          return `pid=${processInfo.pid} ppid=${processInfo.ppid} tree=${quoteValue(
            resolveTreeKey(processInfo, snapshot.processes)
          )} user=${quoteValue(processInfo.user)} rssBytes=${processInfo.rssBytes} deltaRssBytes=${deltaSummary.deltaRssBytes} memPercent=${processInfo.memoryPercent.toFixed(
            1
          )} cpuPercent=${processInfo.cpuPercent.toFixed(1)} name=${quoteValue(processInfo.name)}`;
        })
      : ["no-processes"]),
    "```",
    ""
  ].join("\n");
}

export async function writeSnapshotReport(
  snapshot: ReportSnapshot,
  options: SnapshotReportWriteOptions = {}
): Promise<string> {
  const outputPath = resolveSnapshotReportPath(options, snapshot.collectedAt);
  const report = formatSnapshotReport(snapshot);

  try {
    await mkdir(path.dirname(outputPath), { recursive: true });
  } catch (error) {
    throw wrapReportError("create report directory", error);
  }

  try {
    await writeFile(outputPath, report, "utf8");
  } catch (error) {
    throw wrapReportError("write snapshot report", error);
  }

  return outputPath;
}

export function resolveSnapshotReportPath(
  options: SnapshotReportWriteOptions = {},
  generatedAt = new Date()
): string {
  if (options.outputPath) {
    return path.resolve(options.outputPath);
  }

  const reportsDir = options.reportsDir ? path.resolve(options.reportsDir) : getDefaultReportsDir();
  return path.join(reportsDir, `${DEFAULT_REPORT_FILE_PREFIX}${formatFileTimestamp(generatedAt)}.md`);
}

export function getDefaultReportsDir(homeDirectory = os.homedir()): string {
  if (!homeDirectory) {
    throw new Error("Failed to resolve snapshot report path: home directory is unavailable.");
  }

  return path.join(homeDirectory, "Downloads", DEFAULT_REPORTS_DIR_NAME);
}

function buildExecutiveSummary(
  snapshot: ReportSnapshot,
  topProcessGrowth: ProcessGrowthSummary[],
  topGroups: ProcessGroupSummary[],
  accounting: AccountingSummary,
  availableRatio: number,
  compressedRatio: number
): string {
  const fastestGroup = topGroups[0];
  const fastestProcess = topProcessGrowth[0];

  return `Memory pressure is ${formatPressure(snapshot.memory.pressureLevel)}. Estimated available memory is ${formatBytes(
    snapshot.memory.availableEstimateBytes
  )} (${formatRatio(availableRatio)} of ${formatBytes(
    snapshot.memory.totalBytes
  )} total), while compressed memory is ${formatBytes(snapshot.memory.compressedBytes)} (${formatRatio(
    compressedRatio
  )}) and wired memory is ${formatBytes(snapshot.memory.wiredBytes)}. The report tracked ${formatCount(
    snapshot.samples.length
  )} samples over ${formatDuration(snapshot.diagnostics.windowMs)} and captured ${formatCount(
    accounting.totalProcessCount
  )} visible processes in the final sample. Combined visible RSS is ${formatBytes(
    accounting.visibleProcessRssBytes
  )}, leaving a ${formatBytes(accounting.gapBytes)} gap that is now broken out into compressed, wired, inactive, and other/system memory. ${describeDiagnosticWindow(
    snapshot.diagnostics
  )} ${
    fastestGroup
      ? `The fastest-growing app tree is ${fastestGroup.key} at ${formatSignedBytes(fastestGroup.deltaRssBytes)}.`
      : ""
  } ${
    fastestProcess
      ? `The fastest-growing process is ${fastestProcess.name} (${fastestProcess.pid}) at ${formatSignedBytes(
          fastestProcess.deltaRssBytes
        )}.`
      : ""
  }`.trim();
}

function buildDiagnostics(
  baselineMemory: MemorySummary,
  currentMemory: MemorySummary,
  baselineCollectedAt: Date,
  collectedAt: Date
) {
  const windowMs = Math.max(collectedAt.getTime() - baselineCollectedAt.getTime(), 1);

  return {
    windowMs,
    baselineCollectedAt,
    pageinsDelta: Math.max(0, currentMemory.pageins - baselineMemory.pageins),
    pageoutsDelta: Math.max(0, currentMemory.pageouts - baselineMemory.pageouts),
    swapinsDelta: Math.max(0, currentMemory.swapins - baselineMemory.swapins),
    swapoutsDelta: Math.max(0, currentMemory.swapouts - baselineMemory.swapouts),
    pageinsPerSecond: getRate(currentMemory.pageins - baselineMemory.pageins, windowMs),
    pageoutsPerSecond: getRate(currentMemory.pageouts - baselineMemory.pageouts, windowMs),
    swapinsPerSecond: getRate(currentMemory.swapins - baselineMemory.swapins, windowMs),
    swapoutsPerSecond: getRate(currentMemory.swapouts - baselineMemory.swapouts, windowMs)
  };
}

function summarizeProcessGrowth(samples: ReportTimeSeriesSample[]): ProcessGrowthSummary[] {
  const firstSample = samples[0];
  const lastSample = samples.at(-1);

  if (!firstSample || !lastSample) {
    return [];
  }

  const baseline = new Map(firstSample.processes.map((processInfo) => [processInfo.pid, processInfo]));

  return lastSample.processes
    .map((processInfo) => {
      const previous = baseline.get(processInfo.pid);
      return {
        pid: processInfo.pid,
        user: processInfo.user,
        name: processInfo.name,
        currentRssBytes: processInfo.rssBytes,
        deltaRssBytes: processInfo.rssBytes - (previous?.rssBytes ?? 0),
        memoryPercent: processInfo.memoryPercent,
        cpuPercent: processInfo.cpuPercent
      };
    })
    .sort((left, right) => right.deltaRssBytes - left.deltaRssBytes || right.currentRssBytes - left.currentRssBytes);
}

function summarizeAppGroups(samples: ReportTimeSeriesSample[]): ProcessGroupSummary[] {
  const firstSample = samples[0];
  const lastSample = samples.at(-1);

  if (!firstSample || !lastSample) {
    return [];
  }

  const firstGroups = buildTreeGroupMap(firstSample.processes);
  const lastGroups = buildTreeGroupMap(lastSample.processes);
  const keys = new Set([...firstGroups.keys(), ...lastGroups.keys()]);

  return [...keys]
    .map((key) => {
      const firstGroup = firstGroups.get(key);
      const lastGroup = lastGroups.get(key);
      return {
        key,
        processCount: lastGroup?.processCount ?? 0,
        currentRssBytes: lastGroup?.currentRssBytes ?? 0,
        deltaRssBytes: (lastGroup?.currentRssBytes ?? 0) - (firstGroup?.currentRssBytes ?? 0),
        topMembers: lastGroup?.topMembers ?? firstGroup?.topMembers ?? []
      };
    })
    .sort((left, right) => right.deltaRssBytes - left.deltaRssBytes || right.currentRssBytes - left.currentRssBytes);
}

function buildTreeGroupMap(processes: ProcessInfo[]): Map<string, ProcessGroupSummary> {
  const byPid = new Map(processes.map((processInfo) => [processInfo.pid, processInfo]));
  const groupMap = new Map<string, ProcessGroupSummary>();

  for (const processInfo of processes) {
    const key = resolveTreeKey(processInfo, processes, byPid);
    const current = groupMap.get(key) ?? {
      key,
      processCount: 0,
      currentRssBytes: 0,
      deltaRssBytes: 0,
      topMembers: []
    };

    current.processCount += 1;
    current.currentRssBytes += processInfo.rssBytes;

    if (current.topMembers.length < 3 && !current.topMembers.includes(processInfo.name)) {
      current.topMembers.push(processInfo.name);
    }

    groupMap.set(key, current);
  }

  return groupMap;
}

function buildAccountingSummary(snapshot: ReportSnapshot, topProcessCount: number): AccountingSummary {
  const visibleProcessRssBytes = sumProcessRss(snapshot.processes);
  const topProcessRssBytes = summarizeProcessGrowth(snapshot.samples)
    .slice(0, topProcessCount)
    .reduce((sum, processInfo) => sum + processInfo.currentRssBytes, 0);
  const gapBytes = Math.max(snapshot.memory.totalBytes - visibleProcessRssBytes, 0);
  const majorBuckets = snapshot.memory.compressedBytes + snapshot.memory.wiredBytes + snapshot.memory.inactiveBytes;
  const otherSystemBytes = Math.max(gapBytes - majorBuckets, 0);

  return {
    totalProcessCount: snapshot.processes.length,
    visibleProcessRssBytes,
    topProcessRssBytes,
    visibleProcessRatio: getRatio(visibleProcessRssBytes, snapshot.memory.totalBytes),
    topProcessRatio: getRatio(topProcessRssBytes, snapshot.memory.totalBytes),
    gapBytes,
    gapRatio: getRatio(gapBytes, snapshot.memory.totalBytes),
    otherSystemBytes
  };
}

function describeDiagnosticWindow(diagnostics: ReportSnapshot["diagnostics"]): string {
  if (diagnostics.pageoutsDelta > 0 || diagnostics.swapoutsDelta > 0) {
    return `During the last ${formatDuration(
      diagnostics.windowMs
    )}, the system recorded active outward memory pressure with ${formatCount(
      diagnostics.pageoutsDelta
    )} pageouts and ${formatCount(diagnostics.swapoutsDelta)} swapouts.`;
  }

  if (diagnostics.pageinsDelta > 0 || diagnostics.swapinsDelta > 0) {
    return `During the last ${formatDuration(
      diagnostics.windowMs
    )}, the system showed inbound memory churn with ${formatCount(
      diagnostics.pageinsDelta
    )} pageins and ${formatCount(diagnostics.swapinsDelta)} swapins, but no new pageouts or swapouts.`;
  }

  return `During the last ${formatDuration(
    diagnostics.windowMs
  )}, pageout and swap activity stayed flat, so the current pressure label is being driven more by the present memory state than by new paging deltas.`;
}

function resolveTreeKey(
  processInfo: ProcessInfo,
  processes: ProcessInfo[],
  byPid = new Map(processes.map((entry) => [entry.pid, entry]))
): string {
  let current: ProcessInfo | undefined = processInfo;
  let safety = 0;

  while (current && byPid.has(current.ppid) && safety < 64) {
    const parent = byPid.get(current.ppid);

    if (!parent) {
      break;
    }

    current = parent;
    safety += 1;
  }

  return inferBundleOrFamily(current?.name ?? processInfo.name);
}

function inferBundleOrFamily(name: string): string {
  const helperMatch = name.match(/^(.*?)(?: Helper(?: \([^)]+\))?)$/);

  if (helperMatch?.[1]) {
    return helperMatch[1].trim();
  }

  return name.replace(/\s+\([^)]+\)$/u, "").trim();
}

function findProcessDelta(samples: ReportTimeSeriesSample[], pid: number): { deltaRssBytes: number } {
  const firstSample = samples[0];
  const lastSample = samples.at(-1);

  if (!firstSample || !lastSample) {
    return { deltaRssBytes: 0 };
  }

  const previous = firstSample.processes.find((processInfo) => processInfo.pid === pid);
  const current = lastSample.processes.find((processInfo) => processInfo.pid === pid);

  return {
    deltaRssBytes: (current?.rssBytes ?? 0) - (previous?.rssBytes ?? 0)
  };
}

function getDefaultReportContext(snapshot: ReportSnapshot): ReportContext {
  return {
    hostname: os.hostname(),
    platform: process.platform,
    arch: process.arch,
    commandVersion: TOOL_VERSION,
    generatedAt: snapshot.collectedAt
  };
}

function clampWindow(windowMs: number): number {
  return Math.min(120_000, Math.max(30_000, windowMs));
}

function sumProcessRss(processes: ProcessInfo[]): number {
  return processes.reduce((sum, processInfo) => sum + processInfo.rssBytes, 0);
}

function formatLocalTimestamp(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  const hours = String(value.getHours()).padStart(2, "0");
  const minutes = String(value.getMinutes()).padStart(2, "0");
  const seconds = String(value.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function formatFileTimestamp(value: Date): string {
  return formatLocalTimestamp(value).replace(/[: ]/g, "-");
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  return `${(durationMs / 1000).toFixed(1)} s`;
}

function formatRate(value: number): string {
  return `${value.toFixed(2)}/sec`;
}

function formatSignedBytes(value: number): string {
  const prefix = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${prefix}${formatBytes(Math.abs(value))}`;
}

function escapeMarkdown(value: string): string {
  return value.replace(/\|/g, "\\|");
}

function quoteValue(value: string): string {
  return JSON.stringify(value);
}

function wrapReportError(action: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`Failed to ${action}: ${message}`, {
    cause: error
  });
}

function getRatio(value: number, total: number): number {
  return total > 0 ? value / total : 0;
}

function getRate(value: number, windowMs: number): number {
  return Math.max(value, 0) / (windowMs / 1000);
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
