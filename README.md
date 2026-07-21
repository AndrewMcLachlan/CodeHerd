# CodeHerd

A desktop app for managing multiple Claude Code and OpenAI Codex CLI instances. Think VS Code meets Windows Terminal, but purpose-built for coding agents.

## Features

- **Tabbed interface** - Run Claude Code and Codex sessions side by side
- **Agent-aware new tabs** - Choose any detected CLI agent and configure your preferred default
- **Session persistence** - Tabs auto-resume when you restart the app
- **Session sidebar** - Browse and resume each agent's past sessions per project folder
- **Status bar** - Shows current folder, git branch, dirty state, and terminal status
- **Graceful shutdown** - Cleanly exits agent processes before falling back to a process-tree kill

## Tech Stack

- Electron + TypeScript
- xterm.js for terminal rendering
- node-pty for PTY management
- esbuild for bundling

## Getting Started

```bash
npm install --ignore-scripts
npm start
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl/Cmd+T | New tab (configurable in Preferences — remap or disable it to pass Ctrl+T to the active agent) |
| Ctrl/Cmd+W | Close tab |
| Ctrl/Cmd+B | Toggle sidebar |
| F11 | Toggle fullscreen |
| Ctrl+C | Copy |
| Ctrl+V | Paste |

## License

[MIT](LICENSE)
