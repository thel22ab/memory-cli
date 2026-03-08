import type { ManagedSignal, ProcessInfo } from "../types";

interface SignalServiceDeps {
  ownPid?: number;
  killFn?: (pid: number, signal: ManagedSignal) => void;
}

interface CodeError {
  code?: string;
}

export interface SignalService {
  send(target: ProcessInfo, signal: ManagedSignal): Promise<void>;
}

export function createSignalService(deps: SignalServiceDeps = {}): SignalService {
  const ownPid = deps.ownPid ?? process.pid;
  const killFn = deps.killFn ?? process.kill;

  return {
    async send(target: ProcessInfo, signal: ManagedSignal): Promise<void> {
      if (target.pid === ownPid) {
        throw new Error("Cannot terminate the current memory-cli process.");
      }

      try {
        killFn(target.pid, signal);
      } catch (error) {
        throw mapSignalError(target, signal, error);
      }
    }
  };
}

export function describeProcessRisk(target: ProcessInfo, ownPid = process.pid): string | null {
  if (target.pid === ownPid) {
    return "memory-cli cannot terminate its own process.";
  }

  if (target.uid === 0 || target.user === "root") {
    return `${target.name} is owned by root. macOS may deny the signal, and terminating it can destabilize the system.`;
  }

  return null;
}

function mapSignalError(target: ProcessInfo, signal: ManagedSignal, error: unknown): Error {
  if (isCodeError(error)) {
    if (error.code === "ESRCH") {
      return new Error(`${target.name} (${target.pid}) no longer exists.`);
    }

    if (error.code === "EPERM") {
      return new Error(`Permission denied sending ${signal} to ${target.name} (${target.pid}).`);
    }
  }

  if (error instanceof Error) {
    return new Error(`Failed to send ${signal} to ${target.name} (${target.pid}): ${error.message}`);
  }

  return new Error(`Failed to send ${signal} to ${target.name} (${target.pid}).`);
}

function isCodeError(error: unknown): error is CodeError {
  return typeof error === "object" && error !== null && "code" in error;
}
