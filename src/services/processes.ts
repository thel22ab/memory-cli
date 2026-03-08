import type { ProcessInfo } from "../types";
import { runCommand } from "./command";

const PS_ARGS = ["-arcxo", "pid=,uid=,user=,%mem=,%cpu=,rss=,comm="];

export function parsePsOutput(output: string): ProcessInfo[] {
  return output
    .split(/\r?\n/)
    .map((line) => parsePsLine(line))
    .filter((processInfo): processInfo is ProcessInfo => processInfo !== null)
    .sort((left, right) => right.rssBytes - left.rssBytes);
}

export async function fetchTopProcesses(limit = 10): Promise<ProcessInfo[]> {
  const output = await runCommand("ps", PS_ARGS);
  return parsePsOutput(output).slice(0, limit);
}

function parsePsLine(line: string): ProcessInfo | null {
  const trimmed = line.trim();

  if (!trimmed) {
    return null;
  }

  const [pidToken, uidToken, userToken, memoryToken, cpuToken, rssToken, ...nameParts] =
    trimmed.split(/\s+/);

  if (!pidToken || !uidToken || !userToken || !memoryToken || !cpuToken || !rssToken || nameParts.length === 0) {
    return null;
  }

  const pid = Number(pidToken);
  const uid = Number(uidToken);
  const memoryPercent = Number(memoryToken);
  const cpuPercent = Number(cpuToken);
  const rssKilobytes = Number(rssToken);

  if ([pid, uid, memoryPercent, cpuPercent, rssKilobytes].some((value) => Number.isNaN(value))) {
    return null;
  }

  return {
    pid,
    uid,
    user: userToken,
    name: nameParts.join(" "),
    rssBytes: rssKilobytes * 1024,
    memoryPercent,
    cpuPercent
  };
}

