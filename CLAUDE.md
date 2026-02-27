# CodeHerd - Claude Code Session Manager

## Tech Stack
- Electron 35+ with TypeScript (strict mode)
- xterm.js v6 (@xterm/xterm) for terminal rendering
- node-pty for PTY management
- esbuild for bundling via tsx
- Electron Forge for packaging
- No frontend framework - vanilla TypeScript + DOM manipulation

## Architecture
- `src/main/` - Electron main process (Node.js)
- `src/renderer/` - Electron renderer process (browser)
- `src/shared/` - Types and constants shared between processes
- `src/preload/` - contextBridge API

## Conventions
- All IPC channels defined in src/shared/ipc-channels.ts
- All types in src/shared/types.ts
- State persisted to ~/.codeherd/state.json
- Use uuid v4 for all identifiers
- Use --session-id flag when spawning new Claude sessions
- Use --resume flag when restoring sessions

## Build
- `npm run build` - compile TypeScript via esbuild
- `npm start` - build and run
- `npm run make` - create distributable
