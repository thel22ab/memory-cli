import { describe, expect, test } from "bun:test";

import { parsePsOutput } from "../src/services/processes";

describe("parsePsOutput", () => {
  test("parses process rows and keeps names with spaces", () => {
    const rows = parsePsOutput(
      [
        " 456     1   501 thoger            1.2   4.0  65536 Safari",
        " 123   456   501 thoger            2.5  10.0 131072 Google Chrome Helper (Renderer)"
      ].join("\n")
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      pid: 123,
      ppid: 456,
      uid: 501,
      user: "thoger",
      name: "Google Chrome Helper (Renderer)",
      rssBytes: 131072 * 1024,
      memoryPercent: 2.5,
      cpuPercent: 10
    });
  });
});
