import { describe, expect, test } from "bun:test";

import { parseVmStatOutput } from "../src/services/memory";

describe("parseVmStatOutput", () => {
  test("converts vm_stat pages into bytes and derives pressure", () => {
    const summary = parseVmStatOutput(
      [
        "Mach Virtual Memory Statistics: (page size of 16384 bytes)",
        "Pages free:                                4096.",
        "Pages active:                             2048.",
        "Pages inactive:                           8192.",
        "Pages speculative:                        1024.",
        "Pages wired down:                         1536.",
        "Pages purgeable:                           512.",
        "Pages occupied by compressor:              512.",
        "Pageins:                                    10.",
        "Pageouts:                                   20.",
        "Swapins:                                    30.",
        "Swapouts:                                   40."
      ].join("\n"),
      512 * 1024 * 1024
    );

    expect(summary.pageSize).toBe(16384);
    expect(summary.freeBytes).toBe(4096 * 16384);
    expect(summary.availableEstimateBytes).toBe((4096 + 8192 + 1024 + 512) * 16384);
    expect(summary.swapouts).toBe(40);
    expect(summary.pressureLevel).toBe("normal");
  });
});
