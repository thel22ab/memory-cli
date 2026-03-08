export async function runCommand(command: string, args: string[]): Promise<string> {
  try {
    const subprocess = Bun.spawn([command, ...args], {
      env: {
        ...process.env,
        LANG: "C",
        LC_ALL: "C"
      },
      stdout: "pipe",
      stderr: "pipe"
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(subprocess.stdout).text(),
      new Response(subprocess.stderr).text(),
      subprocess.exited
    ]);

    if (exitCode !== 0) {
      throw new Error(stderr.trim() || `Command exited with code ${exitCode}.`);
    }

    return stdout;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to run ${command}: ${message}`, {
      cause: error
    });
  }
}
