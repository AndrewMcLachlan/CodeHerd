# CodeHerd

A desktop app for managing multiple Claude Code and OpenAI Codex CLI instances. Think VS Code meets Windows Terminal, but purpose-built for coding agents.

## Features

- **Tabbed interface** - Run Claude Code and Codex sessions side by side
- **Agent-aware new tabs** - Choose any detected CLI agent and configure your preferred default
- **Session persistence** - Tabs auto-resume when you restart the app
- **Session sidebar** - Browse and resume each agent's past sessions per project folder
- **Named and coloured tabs** - Supports agent `/rename` metadata and a `/color` palette for both Claude Code and Codex
- **Status bar** - Shows current folder, git branch, dirty state, and terminal status
- **Graceful shutdown** - Cleanly exits agent processes before falling back to a process-tree kill

## Installation

Download the latest release from
[GitHub Releases](https://github.com/AndrewMcLachlan/CodeHerd/releases).
Builds are unsigned — [docs/INSTALL.md](docs/INSTALL.md) covers the
SmartScreen/Gatekeeper prompts you'll see, how to verify downloads
(`SHA256SUMS` and GitHub build-provenance attestations), and
upgrade/downgrade/uninstall steps for each platform.

### Supported platforms

| Platform | Architecture | Status |
|---|---|---|
| Windows 10/11 | x64 | Supported |
| macOS 14+ | Apple Silicon (arm64) | Supported |
| Linux (Ubuntu 24.04+ or equivalent) | x64 | Supported |

Other platforms and architectures (Windows arm64, Intel macOS, other distros)
may work from source but are not built or tested.

### Supported agents

CodeHerd drives the [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
and [OpenAI Codex](https://github.com/openai/codex) CLIs, discovered on your
PATH. It tracks the **latest stable release** of each CLI: every CodeHerd
release is tested against the agent versions current at that time (recorded in
the release notes), with fixture tests pinning the session formats it parses.
Older CLI versions generally still launch and resume fine; where a CLI changes
its output formats, secondary features (status indicators, model/context
metadata) degrade gracefully rather than breaking sessions.

## Tech Stack

- Electron + TypeScript
- xterm.js for terminal rendering
- node-pty for PTY management
- esbuild for bundling

## Developing

```bash
npm install --ignore-scripts
npm start           # build and run (uses ~/.codeherd-dev, not your real state)
npm test            # vitest suite
npm run typecheck   # tsc --noEmit
npm run make        # package distributables
```

Releases follow [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md).

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl/Cmd+T | New tab (configurable in Preferences — remap or disable it to pass Ctrl+T to the active agent) |
| Ctrl/Cmd+W | Close tab |
| Ctrl/Cmd+B | Toggle sidebar |
| F11 | Toggle fullscreen |
| Ctrl+C | Copy |
| Ctrl+V | Paste |

## Troubleshooting

**Help → Open Diagnostics Folder** opens the folder holding `state.json`, its
last-known-good backup, and any opt-in debug logs. Raw terminal logging is off
by default (it can capture prompts and secrets); enable it for a debugging
session with `CODEHERD_PTY_DEBUG=1` or `--pty-debug`.

## License

[MIT](LICENSE)
