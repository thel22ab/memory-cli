import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { fetchMemorySummary } from "./memory";
import { fetchProcesses } from "./processes";
import type {
  MemorySummary,
  ProcessInfo,
  ReportContext,
  ReportSnapshot,
  SnapshotReportWriteOptions
} from "../types";
import { formatBytes, formatCount, formatPressure, formatRatio } from "../ui/format";

const DEFAULT_TOP_PROCESS_LIMIT = 50;
const DEFAULT_GROUP_LIMIT = 15;
const DEFAULT_REPORTS_DIR_NAME = "memory-reports";
const DEFAULT_REPORT_FILE_PREFIX = "memory-report-";
const DEFAULT_DIAGNOSTIC_WINDOW_MS = 10_000;
const TOOL_NAME = "memory-cli";
const TOOL_VERSION = process.env.npm_package_version ?? "0.1.0";

export interface CollectReportSnapshotOptions {
  diagnosticWindowMs?: number;
  fetchMemory?: () => Promise<MemorySummary>;
  fetchProcessList?: () => Promise<ProcessInfo[]>;
  sleep?: (ms: number) => Promise<void>;
}

interface ProcessFamilySummary {
  name: string;
  processCount: number;
  totalRssBytes: number;
  topMembers: string[];
}

interface AccountingSummary {
  totalProcessCount: number;
  visibleProcessRssBytes: number;
  highlightedProcessRssBytes: number;
  visibleProcessRatio: number;
  highlightedProcessRatio: number;
  unexplainedBytes: number;
  unexplainedRatio: number;
}

export async function collectReportSnapshot(
  options: number | CollectReportSnapshotOptions = {}
): Promise<ReportSnapshot> {
  const settings = typeof options === "number" ? { diagnosticWindowMs: options } : options;
  const diagnosticWindowMs = settings.diagnosticWindowMs ?? DEFAULT_DIAGNOSTIC_WINDOW_MS;
  const fetchMemory = settings.fetchMemory ?? fetchMemorySummary;
  const fetchProcessList = settings.fetchProcessList ?? fetchProcesses;
  const sleep = settings.sleep ?? defaultSleep;

  const baselineMemory = await fetchMemory();
  const baselineCollectedAt = new Date();

  if (diagnosticWindowMs > 0) {
    await sleep(diagnosticWindowMs);
  }

  const [processes, memory] = await Promise.all([fetchProcessList(), fetchMemory()]);
  const collectedAt = new Date();

  return {
    processes,
    memory,
    collectedAt,
    diagnostics: buildDiagnostics(baselineMemory, memory, baselineCollectedAt, collectedAt)
  };
}

export function formatSnapshotReport(
  snapshot: ReportSnapshot,
  context = getDefaultReportContext(snapshot)
): string {
  const topProcesses = snapshot.processes.slice(0, DEFAULT_TOP_PROCESS_LIMIT);
  const availableRatio = getRatio(snapshot.memory.availableEstimateBytes, snapshot.memory.totalBytes);
  const compressedRatio = getRatio(snapshot.memory.compressedBytes, snapshot.memory.totalBytes);
  const accounting = buildAccountingSummary(snapshot.processes, snapshot.memory.totalBytes, topProcesses.length);
  const families = summarizeProcessFamilies(snapshot.processes).slice(0, DEFAULT_GROUP_LIMIT);

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
    buildExecutiveSummary(snapshot, topProcesses, accounting, availableRatio, compressedRatio),
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
    `| Sum RSS Across Top ${topProcesses.length} Processes | ${formatBytes(accounting.highlightedProcessRssBytes)} (${formatRatio(
      accounting.highlightedProcessRatio
    )} of physical RAM) |`,
    `| Wired Memory | ${formatBytes(snapshot.memory.wiredBytes)} |`,
    `| Compressed Memory | ${formatBytes(snapshot.memory.compressedBytes)} |`,
    `| Free Memory | ${formatBytes(snapshot.memory.freeBytes)} |`,
    `| Available Estimate | ${formatBytes(snapshot.memory.availableEstimateBytes)} |`,
    `| Unexplained vs Visible Process RSS | ${formatBytes(accounting.unexplainedBytes)} (${formatRatio(
      accounting.unexplainedRatio
    )} of physical RAM) |`,
    "",
    "Visible process RSS is useful for attribution, but it does not map 1:1 to physical memory because of shared pages, compression, and kernel-owned memory.",
    "",
    "## Aggregated Process Families",
    "",
    "| Family | Processes | Total RSS | Share of RAM | Example Members |",
    "| --- | --- | --- | --- | --- |",
    ...(families.length > 0
      ? families.map(
          (family) =>
            `| ${escapeMarkdown(family.name)} | ${formatCount(family.processCount)} | ${formatBytes(
              family.totalRssBytes
            )} | ${formatRatio(getRatio(family.totalRssBytes, snapshot.memory.totalBytes))} | ${escapeMarkdown(
              family.topMembers.join(", ")
            )} |`
        )
      : ["| No grouped process families available | 0 | 0 B | 0.0% | - |"]),
    "",
    "## Pressure Diagnostics",
    "",
    "| Metric | Value |",
    "| --- | --- |",
    `| Diagnostic Window | ${formatDuration(snapshot.diagnostics.windowMs)} |`,
    `| Pageins Delta | ${formatCount(snapshot.diagnostics.pageinsDelta)} (${formatRate(
      snapshot.diagnostics.pageinsPerSecond
    )}) |`,
    `| Pageouts Delta | ${formatCount(snapshot.diagnostics.pageoutsDelta)} (${formatRate(
      snapshot.diagnostics.pageoutsPerSecond
    )}) |`,
    `| Swapins Delta | ${formatCount(snapshot.diagnostics.swapinsDelta)} (${formatRate(
      snapshot.diagnostics.swapinsPerSecond
    )}) |`,
    `| Swapouts Delta | ${formatCount(snapshot.diagnostics.swapoutsDelta)} (${formatRate(
      snapshot.diagnostics.swapoutsPerSecond
    )}) |`,
    "",
    describeDiagnosticWindow(snapshot.diagnostics),
    "",
    `## Top Processes (Top ${topProcesses.length} of ${accounting.totalProcessCount})`,
    "",
    "| PID | USER | RSS | %MEM | %CPU | NAME |",
    "| --- | --- | --- | --- | --- | --- |",
    ...(topProcesses.length > 0
      ? topProcesses.map(
          (processInfo) =>
            `| ${processInfo.pid} | ${escapeMarkdown(processInfo.user)} | ${formatBytes(processInfo.rssBytes)} | ${processInfo.memoryPercent.toFixed(
              1
            )} | ${processInfo.cpuPercent.toFixed(1)} | ${escapeMarkdown(processInfo.name)} |`
        )
      : ["| - | - | 0 B | 0.0 | 0.0 | No processes returned by ps. |"]),
    "",
    "## Raw Memory Counters",
    "",
    "```text",
    `pageSize=${snapshot.memory.pageSize}`,
    `totalBytes=${snapshot.memory.totalBytes}`,
    `availableEstimateBytes=${snapshot.memory.availableEstimateBytes}`,
    `availableRatio=${availableRatio.toFixed(4)}`,
    `freeBytes=${snapshot.memory.freeBytes}`,
    `activeBytes=${snapshot.memory.activeBytes}`,
    `inactiveBytes=${snapshot.memory.inactiveBytes}`,
    `wiredBytes=${snapshot.memory.wiredBytes}`,
    `compressedBytes=${snapshot.memory.compressedBytes}`,
    `compressedRatio=${compressedRatio.toFixed(4)}`,
    `speculativeBytes=${snapshot.memory.speculativeBytes}`,
    `purgeableBytes=${snapshot.memory.purgeableBytes}`,
    `pageins=${snapshot.memory.pageins}`,
    `pageouts=${snapshot.memory.pageouts}`,
    `swapins=${snapshot.memory.swapins}`,
    `swapouts=${snapshot.memory.swapouts}`,
    `pressureLevel=${snapshot.memory.pressureLevel}`,
    `windowMs=${snapshot.diagnostics.windowMs}`,
    `pageinsDelta=${snapshot.diagnostics.pageinsDelta}`,
    `pageoutsDelta=${snapshot.diagnostics.pageoutsDelta}`,
    `swapinsDelta=${snapshot.diagnostics.swapinsDelta}`,
    `swapoutsDelta=${snapshot.diagnostics.swapoutsDelta}`,
    `visibleProcessCount=${accounting.totalProcessCount}`,
    `visibleProcessRssBytes=${accounting.visibleProcessRssBytes}`,
    `unexplainedBytes=${accounting.unexplainedBytes}`,
    "```",
    "",
    "## Raw Process Data",
    "",
    "```text",
    ...(snapshot.processes.length > 0
      ? snapshot.processes.map(
          (processInfo) =>
            `pid=${processInfo.pid} uid=${processInfo.uid} family=${quoteValue(
              inferProcessFamily(processInfo.name)
            )} user=${quoteValue(processInfo.user)} rssBytes=${processInfo.rssBytes} memPercent=${processInfo.memoryPercent.toFixed(
              1
            )} cpuPercent=${processInfo.cpuPercent.toFixed(1)} name=${quoteValue(processInfo.name)}`
        )
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
  topProcesses: ProcessInfo[],
  accounting: AccountingSummary,
  availableRatio: number,
  compressedRatio: number
): string {
  const largestConsumers =
    topProcesses.length > 0
      ? `The largest RAM consumers are ${formatList(
          topProcesses
            .slice(0, 3)
            .map((processInfo) => `${processInfo.name} (PID ${processInfo.pid}, ${formatBytes(processInfo.rssBytes)})`)
        )}.`
      : "No process data was returned by ps.";

  return `Memory pressure is ${formatPressure(snapshot.memory.pressureLevel)}. Estimated available memory is ${formatBytes(
    snapshot.memory.availableEstimateBytes
  )} (${formatRatio(availableRatio)} of ${formatBytes(
    snapshot.memory.totalBytes
  )} total), while compressed memory is ${formatBytes(snapshot.memory.compressedBytes)} (${formatRatio(
    compressedRatio
  )}) and wired memory is ${formatBytes(snapshot.memory.wiredBytes)}. The report captured ${formatCount(
    accounting.totalProcessCount
  )} visible processes, whose combined RSS is ${formatBytes(accounting.visibleProcessRssBytes)}. The current unexplained gap versus visible process RSS is ${formatBytes(
    accounting.unexplainedBytes
  )}. ${describeDiagnosticWindow(snapshot.diagnostics)} ${largestConsumers}`;
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

function summarizeProcessFamilies(processes: ProcessInfo[]): ProcessFamilySummary[] {
  const familyMap = new Map<string, ProcessFamilySummary>();

  for (const processInfo of processes) {
    const familyName = inferProcessFamily(processInfo.name);
    const current = familyMap.get(familyName) ?? {
      name: familyName,
      processCount: 0,
      totalRssBytes: 0,
      topMembers: []
    };

    current.processCount += 1;
    current.totalRssBytes += processInfo.rssBytes;

    if (current.topMembers.length < 3 && !current.topMembers.includes(processInfo.name)) {
      current.topMembers.push(processInfo.name);
    }

    familyMap.set(familyName, current);
  }

  return [...familyMap.values()].sort((left, right) => right.totalRssBytes - left.totalRssBytes);
}

function buildAccountingSummary(
  processes: ProcessInfo[],
  totalBytes: number,
  topProcessCount: number
): AccountingSummary {
  const visibleProcessRssBytes = processes.reduce((sum, processInfo) => sum + processInfo.rssBytes, 0);
  const highlightedProcessRssBytes = processes
    .slice(0, topProcessCount)
    .reduce((sum, processInfo) => sum + processInfo.rssBytes, 0);
  const unexplainedBytes = Math.max(totalBytes - visibleProcessRssBytes, 0);

  return {
    totalProcessCount: processes.length,
    visibleProcessRssBytes,
    highlightedProcessRssBytes,
    visibleProcessRatio: getRatio(visibleProcessRssBytes, totalBytes),
    highlightedProcessRatio: getRatio(highlightedProcessRssBytes, totalBytes),
    unexplainedBytes,
    unexplainedRatio: getRatio(unexplainedBytes, totalBytes)
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

function inferProcessFamily(name: string): string {
  const helperMatch = name.match(/^(.*?)(?: Helper(?: \([^)]+\))?)$/);

  if (helperMatch?.[1]) {
    return helperMatch[1].trim();
  }

  return name.replace(/\s+\([^)]+\)$/u, "").trim();
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

function escapeMarkdown(value: string): string {
  return value.replace(/\|/g, "\\|");
}

function quoteValue(value: string): string {
  return JSON.stringify(value);
}

function formatList(values: string[]): string {
  if (values.length <= 1) {
    return values[0] ?? "";
  }

  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }

  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
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
