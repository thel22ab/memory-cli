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
  refreshMs?: number;
  signalService?: SignalService;
  topN?: number;
}

export function createApp(options: AppOptions = {}): App {
  const collect = options.collect ?? (() => collectSnapshot(options.topN ?? 10));
  const signalService = options.signalService ?? createSignalService();
  const refreshMs = options.refreshMs ?? 1500;
  const dashboardFactory = options.dashboardFactory ?? createDashboard;

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
        dashboard.render(snapshot);

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

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
