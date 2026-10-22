import { describe, expect, it } from 'vitest';
import { Terminal } from '@xterm/xterm';
import { matchAgentCharacterWidths } from './character-widths';

const terminal = (): Terminal => {
  const t = new Terminal({ cols: 40, rows: 3, allowProposedApi: true });
  matchAgentCharacterWidths(t);
  return t;
};

const write = (t: Terminal, data: string): Promise<void> => new Promise((r) => t.write(data, r));

describe('matchAgentCharacterWidths', () => {
  it.each(['🔵', '🟡', '🟠', '🟢', '🔨', '✅', '⚫'])('counts %s as two columns, as the agents do', async (emoji) => {
    const t = terminal();
    await write(t, emoji);
    expect(t.buffer.active.cursorX).toBe(2);
  });

  it.each(['❯', '●', '⎿', '✻', '→'])('keeps %s at one column', async (glyph) => {
    const t = terminal();
    await write(t, glyph);
    expect(t.buffer.active.cursorX).toBe(1);
  });

  it('lands an in-place redraw on the cell the agent computed', async () => {
    const t = terminal();
    // "| 🟡Planning | " is 15 columns with a two-column emoji, so the count is column 16.
    await write(t, '| 🟡Planning | 3 |');
    await write(t, '\x1b[1;16H7');
    expect(t.buffer.active.getLine(0)!.translateToString(true)).toBe('| 🟡Planning | 7 |');
  });
});
