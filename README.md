# CodeHerd

A desktop app for managing multiple Claude Code CLI instances. Think VS Code meets Windows Terminal, but purpose-built for Claude Code.

## Features

- **Tabbed interface** - Run multiple Claude Code sessions side by side
- **Session persistence** - Tabs auto-resume when you restart the app
- **Session sidebar** - Browse and resume past sessions per project folder
- **Status bar** - Shows current folder, git branch, dirty state, and Claude's status
- **Graceful shutdown** - Cleanly exits Claude processes to prevent config corruption

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
| Ctrl/Cmd+T | New tab |
| Ctrl/Cmd+W | Close tab |
| Ctrl/Cmd+B | Toggle sidebar |
| F11 | Toggle fullscreen |
| Ctrl+C | Copy |
| Ctrl+V | Paste |

## License

[MIT](LICENSE)
