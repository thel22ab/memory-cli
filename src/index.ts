#!/usr/bin/env bun

import { runCli } from "./cli";

export async function run(): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error("memory-cli currently supports macOS only.");
  }

  const exitCode = await runCli(process.argv.slice(2));
  process.exitCode = exitCode;
}

if (require.main === module) {
  void run().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
