import { fetchMemorySummary } from "./services/memory";
import { fetchTopProcesses } from "./services/processes";
import { createSignalService, describeProcessRisk, type SignalService } from "./services/signals";
import type { ManagedSignal, Snapshot } from "./types";
import { createDashboard, type Dashboard, type DashboardHandlers, type StatusTone } from "./ui/dashboard";

export interface App {
  start: () => Promise<void>;
  stop: () => void;
}

export interface AppOptions {
  collect?: () => Promise<Snapshot>;
  dashboardFactory?: (handlers: DashboardHandlers) => Dashboard;
  now?: () => number;
  refreshMs?: number;
  signalService?: SignalService;
  sortIntervalMs?: number;
  topN?: number;
}

export function createApp(options: AppOptions = {}): App {
  const collect = options.collect ?? (() => collectSnapshot(options.topN ?? 10));
  const signalService = options.signalService ?? createSignalService();
  const now = options.now ?? Date.now;
  const refreshMs = options.refreshMs ?? 1500;
  const sortIntervalMs = options.sortIntervalMs ?? 10_000;
  const dashboardFactory = options.dashboardFactory ?? createDashboard;

  let displaySnapshot: Snapshot | null = null;
  let lastSortedAt = 0;
  let refreshPromise: Promise<void> | null = null;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  const dashboard = dashboardFactory({
    onForceKill: (target) => handleSignal(target, "SIGKILL"),
    onQuit: () => stop(),
    onRefresh: () => refresh(true),
    onTerminate: (target) => handleSignal(target, "SIGTERM")
  });

  return {
    start,
    stop
  };

  async function start(): Promise<void> {
    if (stopped) {
      throw new Error("This app instance has already been stopped.");
    }

    await refresh(false);
    refreshTimer = setInterval(() => {
      void refresh(false);
    }, refreshMs);
  }

  function stop(): void {
    if (stopped) {
      return;
    }

    stopped = true;

    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }

    dashboard.destroy();
  }

  async function refresh(announce: boolean): Promise<void> {
    if (stopped) {
      return;
    }

    if (refreshPromise) {
      return refreshPromise;
    }

    refreshPromise = (async () => {
      try {
        const snapshot = await collect();
        const shouldResort = displaySnapshot === null || now() - lastSortedAt >= sortIntervalMs;
        displaySnapshot = stabilizeSnapshot(displaySnapshot, snapshot, shouldResort);

        if (shouldResort) {
          lastSortedAt = now();
        }

        dashboard.render(displaySnapshot);

        if (announce) {
          setStatus(`Refreshed at ${snapshot.collectedAt.toLocaleTimeString()}.`, "info");
        }
      } catch (error) {
        setStatus(toErrorMessage(error), "error");
      } finally {
        refreshPromise = null;
      }
    })();

    return refreshPromise;
  }

  async function handleSignal(target: Snapshot["processes"][number], signal: ManagedSignal): Promise<void> {
    const risk = describeProcessRisk(target);

    if (risk) {
      setStatus(risk, "warning");
    }

    try {
      await signalService.send(target, signal);
      await refresh(false);
      setStatus(`${signal} sent to ${target.name} (${target.pid}).`, "success");
    } catch (error) {
      setStatus(toErrorMessage(error), "error");
    }
  }

  function setStatus(message: string, tone: StatusTone): void {
    dashboard.setStatus(message, tone);
  }
}

export async function collectSnapshot(topN = 10): Promise<Snapshot> {
  const [processes, memory] = await Promise.all([fetchTopProcesses(topN), fetchMemorySummary()]);

  return {
    processes,
    memory,
    collectedAt: new Date()
  };
}

function stabilizeSnapshot(
  previousSnapshot: Snapshot | null,
  nextSnapshot: Snapshot,
  shouldResort: boolean
): Snapshot {
  if (!previousSnapshot || shouldResort) {
    return nextSnapshot;
  }

  const previousOrder = new Map(previousSnapshot.processes.map((processInfo, index) => [processInfo.pid, index]));
  const processes = [...nextSnapshot.processes].sort((left, right) => {
    const leftIndex = previousOrder.get(left.pid) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = previousOrder.get(right.pid) ?? Number.MAX_SAFE_INTEGER;

    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }

    return right.rssBytes - left.rssBytes;
  });

  return {
    ...nextSnapshot,
    processes
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
