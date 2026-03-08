import blessed from "neo-blessed";

import type { ProcessInfo, Snapshot } from "../types";
import { formatBytes, formatCount, formatPressure, formatProcessRow, truncate } from "./format";

export type StatusTone = "info" | "success" | "warning" | "error";

export interface DashboardHandlers {
  onForceKill: (target: ProcessInfo) => Promise<void> | void;
  onQuit: () => void;
  onRefresh: () => Promise<void> | void;
  onTerminate: (target: ProcessInfo) => Promise<void> | void;
}

export interface Dashboard {
  destroy: () => void;
  render: (snapshot: Snapshot) => void;
  setStatus: (message: string, tone?: StatusTone) => void;
}

interface StatusState {
  message: string;
  tone: StatusTone;
}

const HELP_TEXT = "up/down move  |  t terminate  |  k force kill  |  r refresh  |  q quit";
const NAVIGATION_KEYS = ["up", "down", "pageup", "pagedown", "home", "end"];

export function createDashboard(handlers: DashboardHandlers): Dashboard {
  const screen = blessed.screen({
    autoPadding: true,
    dockBorders: true,
    smartCSR: true,
    terminal: resolveTerminal(),
    title: "memory-cli"
  });

  const summaryBox = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: "100%",
    height: 9,
    border: "line",
    label: " Memory Summary ",
    tags: true,
    padding: {
      left: 1,
      right: 1
    }
  });

  const processFrame = blessed.box({
    parent: screen,
    top: 9,
    left: 0,
    width: "100%",
    bottom: 3,
    border: "line",
    label: " Top Processes ",
    padding: {
      left: 1,
      right: 1
    }
  });

  blessed.box({
    parent: processFrame,
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    content: "    PID USER             RSS   %MEM   %CPU NAME"
  });

  const processList = blessed.list({
    parent: processFrame,
    top: 1,
    left: 0,
    right: 0,
    bottom: 0,
    keys: true,
    mouse: false,
    tags: false,
    style: {
      selected: {
        bg: "blue",
        fg: "white"
      }
    },
    scrollbar: {
      ch: " ",
      style: {
        bg: "blue"
      }
    },
    items: ["Loading process list..."]
  });

  const footerBox = blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    width: "100%",
    height: 3,
    border: "line",
    label: " Status ",
    tags: true,
    padding: {
      left: 1,
      right: 1
    }
  });

  let currentSnapshot: Snapshot | null = null;
  let statusState: StatusState = {
    message: "Collecting memory snapshot...",
    tone: "info"
  };
  let destroyed = false;

  processList.focus();

  processList.on("keypress", (_character, key) => {
    if (key.name && NAVIGATION_KEYS.includes(key.name)) {
      renderCurrentState();
    }
  });

  processList.key("t", () => {
    const target = getSelectedProcess();

    if (!target) {
      setStatus("No process is currently selected.", "warning");
      return;
    }

    void handlers.onTerminate(target);
  });

  processList.key("k", () => {
    const target = getSelectedProcess();

    if (!target) {
      setStatus("No process is currently selected.", "warning");
      return;
    }

    void confirm(`Force kill ${target.name} (${target.pid})?`).then((confirmed) => {
      if (!confirmed) {
        setStatus("Force kill cancelled.", "info");
        return;
      }

      return Promise.resolve(handlers.onForceKill(target));
    });
  });

  screen.key("r", () => {
    void handlers.onRefresh();
  });

  screen.key(["q", "C-c"], () => {
    handlers.onQuit();
  });

  renderFooter();
  screen.render();

  return {
    destroy,
    render,
    setStatus
  };

  function render(snapshot: Snapshot): void {
    if (destroyed) {
      return;
    }

    const previousPid = getSelectedProcess()?.pid ?? null;
    currentSnapshot = snapshot;

    const items =
      snapshot.processes.length > 0
        ? snapshot.processes.map((processInfo) => formatProcessRow(processInfo, getNameWidth()))
        : ["No processes returned by ps."];

    processList.setItems(items);

    if (snapshot.processes.length > 0) {
      const nextIndex = previousPid
        ? Math.max(
            0,
            snapshot.processes.findIndex((processInfo) => processInfo.pid === previousPid)
          )
        : 0;

      processList.select(nextIndex);
    }

    renderCurrentState();
  }

  function setStatus(message: string, tone: StatusTone = "info"): void {
    if (destroyed) {
      return;
    }

    statusState = { message, tone };
    renderFooter();
    screen.render();
  }

  function destroy(): void {
    if (destroyed) {
      return;
    }

    destroyed = true;
    screen.destroy();
  }

  function renderCurrentState(): void {
    if (destroyed) {
      return;
    }

    summaryBox.setContent(buildSummary(currentSnapshot, getSelectedProcess()));
    renderFooter();
    screen.render();
  }

  function renderFooter(): void {
    footerBox.setContent(`${colorize(statusState.message, statusState.tone)}\n${HELP_TEXT}`);
  }

  function getSelectedProcess(): ProcessInfo | undefined {
    if (!currentSnapshot || currentSnapshot.processes.length === 0) {
      return undefined;
    }

    const selectedIndex = getSelectedIndex();
    return currentSnapshot.processes[selectedIndex];
  }

  async function confirm(message: string): Promise<boolean> {
    return new Promise((resolve) => {
      const modal = blessed.box({
        parent: screen,
        top: "center",
        left: "center",
        width: "70%",
        height: 7,
        border: "line",
        label: " Confirm ",
        tags: true,
        padding: {
          left: 1,
          right: 1
        },
        content: `${truncate(message, 68)}\n\nPress y to confirm or n to cancel.`,
        style: {
          border: {
            fg: "yellow"
          }
        }
      });

      const keys = ["y", "n", "escape"];
      const handleKey = (_character: string, key: blessed.Widgets.Events.IKeyEventArg) => {
        if (!key.name) {
          return;
        }

        cleanup(key.name === "y");
      };

      const cleanup = (confirmed: boolean) => {
        for (const keyName of keys) {
          screen.unkey(keyName, handleKey);
        }

        modal.destroy();
        processList.focus();
        renderCurrentState();
        resolve(confirmed);
      };

      screen.key(keys, handleKey);
      modal.focus();
      screen.render();
    });
  }

  function getNameWidth(): number {
    const width = typeof screen.width === "number" ? screen.width : 100;
    return Math.max(20, width - 41);
  }

  function getSelectedIndex(): number {
    const selected = (processList as blessed.Widgets.ListElement & { selected?: number }).selected;
    return typeof selected === "number" ? selected : 0;
  }
}

function buildSummary(snapshot: Snapshot | null, selectedProcess: ProcessInfo | undefined): string {
  if (!snapshot) {
    return "Waiting for the first memory snapshot...";
  }

  const { memory } = snapshot;
  const pressureColor = getPressureColor(memory.pressureLevel);
  const selectedLine = selectedProcess
    ? `Selected: ${selectedProcess.name} (${selectedProcess.pid})  RSS ${formatBytes(selectedProcess.rssBytes)}  MEM ${selectedProcess.memoryPercent.toFixed(1)}%  CPU ${selectedProcess.cpuPercent.toFixed(1)}%  USER ${selectedProcess.user}`
    : "Selected: none";

  return [
    `{bold}Pressure:{/bold} {${pressureColor}-fg}${formatPressure(memory.pressureLevel)}{/${pressureColor}-fg}   {bold}Available est:{/bold} ${formatBytes(memory.availableEstimateBytes)}   {bold}Total:{/bold} ${formatBytes(memory.totalBytes)}`,
    `{bold}Free:{/bold} ${formatBytes(memory.freeBytes)}   {bold}Active:{/bold} ${formatBytes(memory.activeBytes)}   {bold}Inactive:{/bold} ${formatBytes(memory.inactiveBytes)}`,
    `{bold}Wired:{/bold} ${formatBytes(memory.wiredBytes)}   {bold}Compressed:{/bold} ${formatBytes(memory.compressedBytes)}   {bold}Speculative:{/bold} ${formatBytes(memory.speculativeBytes)}`,
    `{bold}Pageouts:{/bold} ${formatCount(memory.pageouts)}   {bold}Swapouts:{/bold} ${formatCount(memory.swapouts)}   {bold}Last refresh:{/bold} ${snapshot.collectedAt.toLocaleTimeString()}`,
    "",
    truncate(selectedLine, 110)
  ].join("\n");
}

function colorize(message: string, tone: StatusTone): string {
  const color =
    tone === "success" ? "green" : tone === "warning" ? "yellow" : tone === "error" ? "red" : "cyan";

  return `{${color}-fg}${message}{/${color}-fg}`;
}

function getPressureColor(level: Snapshot["memory"]["pressureLevel"]): string {
  if (level === "critical") {
    return "red";
  }

  if (level === "elevated") {
    return "yellow";
  }

  return "green";
}

function resolveTerminal(): string | undefined {
  const term = process.env.TERM;

  if (term === "xterm-ghostty") {
    return "xterm-256color";
  }

  return term;
}
