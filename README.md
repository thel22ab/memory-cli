# memory-cli

`memory-cli` is a focused macOS terminal dashboard for memory-pressure triage.

When your Mac starts swapping, fans spin up, and Activity Monitor feels slower than your train of thought, `memory-cli` gives you a fast path: see the biggest RAM consumers, understand current memory pressure, and terminate the worst offender without leaving the terminal.

## Why This Exists

`memory-cli` is built for the moment when you do not want a full system monitor. You want a short list of the biggest memory hogs, a quick read on system pressure, and one or two keyboard actions to get your machine responsive again.

It is intentionally narrow:

- optimized for memory triage, not general process management
- focused on the top RAM consumers so the interface stays readable
- designed for keyboard-first use in the terminal
- backed by native macOS commands instead of a heavyweight runtime layer

## What It Shows

- top memory-consuming processes from `ps`
- a live memory summary from `vm_stat`
- a simple pressure heuristic: `NORMAL`, `ELEVATED`, or `CRITICAL`
- the currently selected process with PID, RSS, memory %, CPU %, and owner
- inline status messages for refreshes, warnings, and signal results

## What You Can Do

- move through the process list with the keyboard
- send `SIGTERM` to ask a process to exit cleanly
- confirm and send `SIGKILL` when a process is truly wedged
- refresh on demand or let the dashboard keep updating automatically
- save a snapshot report for later analysis

## Safety Rails

This tool is intentionally opinionated about dangerous actions:

- it refuses to terminate the running `memory-cli` process
- it warns before force-killing a process
- it warns when the selected process is owned by `root`
- it surfaces friendly error messages for common failures like missing processes or permission errors

## Requirements

- macOS
- Bun `1.3.3+`

This project is macOS-only because it relies on `vm_stat` and macOS `ps` output.

## Installation

Clone the repo and install dependencies:

```bash
git clone https://github.com/thoger/memory-cli.git
cd memory-cli
bun install
```

Run in development:

```bash
bun run dev
```

Build and run the compiled CLI:

```bash
bun run build
bun run start
```

## Usage

Launch the app and you will see:

- a memory summary at the top
- the top memory consumers in the middle
- a status/help area at the bottom

Keyboard shortcuts:

- `up/down`: move the selection
- `pageup/pagedown`, `home/end`: jump through the list
- `t`: send `SIGTERM` to the selected process
- `k`: confirm and send `SIGKILL` to the selected process
- `r`: refresh immediately
- `s`: write a snapshot report to `~/Downloads/memory-reports`
- `q` or `Ctrl+C`: quit

CLI subcommands:

- `memory-cli`: launch the live dashboard
- `memory-cli snapshot-report`: write a Markdown snapshot report and print its path

## How It Works

`memory-cli` collects a snapshot every 1.5 seconds by default:

- process data comes from `ps`
- system memory data comes from `vm_stat`
- the dashboard is rendered with `neo-blessed`
- process signals are sent through Bun's process APIs with extra guardrails and friendlier errors

The memory pressure label is a lightweight heuristic derived from estimated available memory and compressed memory. It is meant to help you decide how urgent the situation is, not replace full system diagnostics.

## Snapshot Reports

Snapshot reports are written to `~/Downloads/memory-reports` by default. Each report now combines several layers so the process list and the pressure diagnosis are easier to reconcile:

- all visible processes for full RSS accounting
- a top-process view that shows the top 50 processes by RSS
- aggregated process families so helpers and renderer trees roll up into app-level totals
- a memory-accounting section with visible RSS totals and an unexplained-vs-visible gap
- a pressure-diagnostics section with pagein/pageout/swap deltas over a short sampling window
- raw counter/process blocks you can paste into issues or notes

The live dashboard still shows the top 20 processes to stay focused in the terminal. Reports intentionally go wider and slower so they are more useful for root-cause analysis than the live TUI.

## Development

Useful commands:

```bash
bun run dev
bun run build
bun run lint
bun run typecheck
bun test
```

The project is written in TypeScript, uses Bun as the runtime/tooling layer, and includes tests for:

- `ps` parsing
- `vm_stat` parsing
- signal safety/error handling
- app wiring between data collection and the terminal UI

## Current Scope

`memory-cli` is early, small, and intentionally focused. It does one job: help you identify and stop runaway memory consumers on macOS quickly from the terminal.

If you want a full observability dashboard, this is not that. If you want a fast memory pressure control panel, that is exactly what this repo is for.
