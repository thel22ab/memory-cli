import { describe, expect, mock, test } from "bun:test";

import { createApp } from "../src/app";
import type { Dashboard, DashboardHandlers } from "../src/ui/dashboard";
import type { Snapshot } from "../src/types";

const snapshot: Snapshot = {
  processes: [
    {
      pid: 321,
      uid: 501,
      user: "thoger",
      name: "Safari",
      rssBytes: 512 * 1024 * 1024,
      memoryPercent: 3.2,
      cpuPercent: 1.1
    }
  ],
  memory: {
    pageSize: 16384,
    totalBytes: 16 * 1024 * 1024 * 1024,
    availableEstimateBytes: 4 * 1024 * 1024 * 1024,
    freeBytes: 1 * 1024 * 1024 * 1024,
    activeBytes: 6 * 1024 * 1024 * 1024,
    inactiveBytes: 2 * 1024 * 1024 * 1024,
    wiredBytes: 3 * 1024 * 1024 * 1024,
    compressedBytes: 1 * 1024 * 1024 * 1024,
    speculativeBytes: 512 * 1024 * 1024,
    purgeableBytes: 512 * 1024 * 1024,
    pageins: 10,
    pageouts: 20,
    swapins: 30,
    swapouts: 40,
    pressureLevel: "elevated"
  },
  collectedAt: new Date("2026-03-08T12:00:00.000Z")
};

describe("createApp", () => {
  test("refreshes data on start and wires signal actions", async () => {
    const collect = mock(async () => snapshot);
    const render = mock();
    const setStatus = mock();
    const destroy = mock();
    const send = mock(async () => undefined);
    let handlers: DashboardHandlers | undefined;

    const dashboardFactory = (nextHandlers: DashboardHandlers): Dashboard => {
      handlers = nextHandlers;
      return {
        render,
        setStatus,
        destroy
      };
    };

    const app = createApp({
      collect,
      dashboardFactory,
      refreshMs: 60_000,
      signalService: {
        send
      }
    });

    await app.start();

    expect(collect).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledWith(snapshot);

    await handlers?.onTerminate(snapshot.processes[0]);
    expect(send).toHaveBeenCalledWith(snapshot.processes[0], "SIGTERM");

    handlers?.onQuit();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  test("keeps process order stable until the next sort window", async () => {
    const firstSnapshot: Snapshot = {
      ...snapshot,
      collectedAt: new Date("2026-03-08T12:00:00.000Z"),
      processes: [
        {
          pid: 100,
          uid: 501,
          user: "thoger",
          name: "First",
          rssBytes: 900,
          memoryPercent: 4,
          cpuPercent: 1
        },
        {
          pid: 200,
          uid: 501,
          user: "thoger",
          name: "Second",
          rssBytes: 700,
          memoryPercent: 3,
          cpuPercent: 1
        }
      ]
    };
    const secondSnapshot: Snapshot = {
      ...snapshot,
      collectedAt: new Date("2026-03-08T12:00:05.000Z"),
      processes: [
        {
          pid: 200,
          uid: 501,
          user: "thoger",
          name: "Second",
          rssBytes: 1200,
          memoryPercent: 5,
          cpuPercent: 1
        },
        {
          pid: 100,
          uid: 501,
          user: "thoger",
          name: "First",
          rssBytes: 800,
          memoryPercent: 4,
          cpuPercent: 1
        }
      ]
    };
    const thirdSnapshot: Snapshot = {
      ...snapshot,
      collectedAt: new Date("2026-03-08T12:00:12.000Z"),
      processes: [...secondSnapshot.processes]
    };

    const snapshots = [firstSnapshot, secondSnapshot, thirdSnapshot];
    const collect = mock(async () => snapshots.shift() ?? thirdSnapshot);

    const render = mock();
    let handlers: DashboardHandlers | undefined;
    const dashboardFactory = (nextHandlers: DashboardHandlers): Dashboard => {
      handlers = nextHandlers;
      return {
        render,
        setStatus: mock(),
        destroy: mock()
      };
    };

    const times = [0, 5_000, 12_000];
    const app = createApp({
      collect,
      dashboardFactory,
      now: () => times.shift() ?? 12_000,
      refreshMs: 60_000,
      sortIntervalMs: 10_000,
      signalService: {
        send: mock(async () => undefined)
      }
    });

    await app.start();
    await handlers?.onRefresh();
    await handlers?.onRefresh();

    expect(render.mock.calls[0][0].processes.map((processInfo: { pid: number }) => processInfo.pid)).toEqual([
      100,
      200
    ]);
    expect(render.mock.calls[1][0].processes.map((processInfo: { pid: number }) => processInfo.pid)).toEqual([
      100,
      200
    ]);
    expect(render.mock.calls[2][0].processes.map((processInfo: { pid: number }) => processInfo.pid)).toEqual([
      200,
      100
    ]);
  });
});
