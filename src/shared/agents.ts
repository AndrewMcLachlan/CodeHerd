import type { AgentAvailability, AgentType } from './types';

const AGENT_ORDER: readonly AgentType[] = ['claude', 'codex'];

const AGENT_LABELS: Record<AgentType, string> = {
  claude: 'Claude',
  codex: 'Codex',
};

export interface NewTabMenuOption {
  label: string;
  agent: AgentType | null;
}

export function resolveDefaultAgent(
  availableAgents: AgentAvailability,
  configuredDefault: AgentType,
): AgentType | null {
  if (availableAgents[configuredDefault]) return configuredDefault;
  return AGENT_ORDER.find(agent => availableAgents[agent]) ?? null;
}

/**
 * Keep the single-agent case generic, but make both choices explicit when two
 * agents are installed. The configured (or first available) default comes first.
 */
export function getNewTabMenuOptions(
  availableAgents: AgentAvailability,
  configuredDefault: AgentType,
): NewTabMenuOption[] {
  const detected = AGENT_ORDER.filter(agent => availableAgents[agent]);
  if (detected.length === 0) return [{ label: 'New Tab', agent: null }];
  if (detected.length === 1) return [{ label: 'New Tab', agent: detected[0] }];

  const defaultAgent = resolveDefaultAgent(availableAgents, configuredDefault)!;
  const ordered = [defaultAgent, ...detected.filter(agent => agent !== defaultAgent)];
  return ordered.map(agent => ({
    label: `New ${AGENT_LABELS[agent]} Tab`,
    agent,
  }));
}

/**
 * Codex includes the current chat name in its OSC terminal title. Busy titles
 * prefix it with a braille spinner; attention titles put it after a pipe.
 */
export function getCodexLabelFromTerminalTitle(title: string): string | null {
  const afterStatus = title.includes(' | ')
    ? title.slice(title.lastIndexOf(' | ') + 3)
    : title;
  const label = afterStatus.replace(/^[\u2800-\u28ff]\s*/, '').trim();
  const isProcessTitle = /^[a-z]:[\\/].*\.exe\s*$/i.test(label)
    || /^(?:windows powershell|command prompt)$/i.test(label)
    || /^(?:npm|npx|node|pnpm|yarn)(?:\s|$)/i.test(label);
  if (
    !label
    || /^\[.*\]\s*(?:action required)?$/i.test(label)
    || label.toLowerCase() === 'codex'
    || isProcessTitle
  ) {
    return null;
  }
  return label;
}
