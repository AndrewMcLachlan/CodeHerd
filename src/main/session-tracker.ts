import * as fs from 'fs';
import * as readline from 'readline';
import { CLAUDE_HISTORY_FILE } from '../shared/constants';
import type { ClaudeSession, FolderPath } from '../shared/types';

export class SessionTracker {
  async getSessionsForFolder(folder: FolderPath): Promise<ClaudeSession[]> {
    if (!fs.existsSync(CLAUDE_HISTORY_FILE)) {
      return [];
    }

    const sessions = new Map<string, ClaudeSession>();

    const stream = fs.createReadStream(CLAUDE_HISTORY_FILE, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        // Normalize paths for comparison (handle Windows backslash vs forward slash)
        const entryProject = (entry.project || '').replace(/\\/g, '/').toLowerCase();
        const targetFolder = folder.replace(/\\/g, '/').toLowerCase();

        if (entryProject === targetFolder && entry.sessionId) {
          sessions.set(entry.sessionId, {
            sessionId: entry.sessionId,
            project: entry.project || folder,
            lastPrompt: entry.display || entry.prompt || '(no prompt)',
            timestamp: entry.timestamp || 0,
          });
        }
      } catch {
        // Skip malformed lines
      }
    }

    // Sort by timestamp descending (most recent first)
    return Array.from(sessions.values()).sort((a, b) => b.timestamp - a.timestamp);
  }
}
