import { describe, expect, mock, test } from "bun:test";

import { createSignalService, describeProcessRisk } from "../src/services/signals";
import type { ProcessInfo } from "../src/types";

const sampleProcess: ProcessInfo = {
  pid: 999,
  uid: 501,
  user: "thoger",
  name: "Example App",
  rssBytes: 1024,
  memoryPercent: 1,
  cpuPercent: 0.5
};

describe("createSignalService", () => {
  test("blocks attempts to kill the current process", async () => {
    const service = createSignalService({
      ownPid: 999,
      killFn: mock()
    });

    await expect(service.send(sampleProcess, "SIGTERM")).rejects.toThrow(/current memory-cli process/i);
  });

  test("maps permission failures into a friendly error", async () => {
    const service = createSignalService({
      ownPid: 111,
      killFn: mock(() => {
        const error = new Error("not permitted") as Error & { code?: string };
        error.code = "EPERM";
        throw error;
      })
    });

    await expect(service.send(sampleProcess, "SIGKILL")).rejects.toThrow(/permission denied/i);
  });
});

describe("describeProcessRisk", () => {
  test("warns when the target is root-owned", () => {
    expect(
      describeProcessRisk({
        ...sampleProcess,
        uid: 0,
        user: "root"
      })
    ).toMatch(/owned by root/i);
  });
});
