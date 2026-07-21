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

/** Distinguish a user `/rename` from Codex's generated first-prompt title. */
export function isCustomCodexSessionName(
  title: string | null | undefined,
  firstUserMessage: string | null | undefined,
  preview: string | null | undefined,
): boolean {
  const name = title?.trim();
  if (!name) return false;
  const generatedNames = [firstUserMessage, preview]
    .map(value => value?.trim())
    .filter((value): value is string => !!value);
  return !generatedNames.includes(name);
}
