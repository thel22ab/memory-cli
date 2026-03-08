import type { PressureLevel, ProcessInfo } from "../types";

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const digits = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatPressure(level: PressureLevel): string {
  return level.toUpperCase();
}

export function formatRatio(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatProcessRow(processInfo: ProcessInfo, nameWidth: number): string {
  const pid = pad(String(processInfo.pid), 7, "left");
  const user = pad(truncate(processInfo.user, 12), 12, "right");
  const rss = pad(formatBytes(processInfo.rssBytes), 9, "left");
  const memory = pad(`${processInfo.memoryPercent.toFixed(1)}%`, 6, "left");
  const cpu = pad(`${processInfo.cpuPercent.toFixed(1)}%`, 6, "left");
  const name = pad(truncate(processInfo.name, nameWidth), nameWidth, "right");

  return `${pid} ${user} ${rss} ${memory} ${cpu} ${name}`;
}

export function truncate(value: string, width: number): string {
  if (value.length <= width) {
    return value;
  }

  if (width <= 3) {
    return value.slice(0, width);
  }

  return `${value.slice(0, width - 3)}...`;
}

function pad(value: string, width: number, align: "left" | "right"): string {
  return align === "left" ? value.padStart(width, " ") : value.padEnd(width, " ");
}
