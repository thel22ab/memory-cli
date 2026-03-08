#!/usr/bin/env bun

import { createApp } from "./app";

export async function run(): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error("memory-cli currently supports macOS only.");
  }

  const app = createApp();

  try {
    await app.start();
  } catch (error) {
    app.stop();
    throw error;
  }
}

if (require.main === module) {
  void run().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
