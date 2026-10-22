import type { Terminal } from '@xterm/xterm';
import { Unicode11Addon } from '@xterm/addon-unicode11';

/**
 * Measure characters the way the agents do.
 *
 * Claude Code and Codex count emoji such as 🟡 and ✅ as two columns; xterm's default
 * table counts them as one. Agents redraw in place at the columns they computed, so a
 * mismatch strands stale characters beside every emoji until the next full redraw.
 *
 * The terminal must be created with allowProposedApi, or this throws.
 */
export function matchAgentCharacterWidths(terminal: Pick<Terminal, 'loadAddon' | 'unicode'>): void {
  terminal.loadAddon(new Unicode11Addon());
  terminal.unicode.activeVersion = '11';
}
