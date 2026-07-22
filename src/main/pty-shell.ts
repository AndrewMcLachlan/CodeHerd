import { execFileSync } from 'child_process';
import { resolveCommandPath } from './agent-detection';

export type WindowsPtyShellKind = 'pwsh' | 'windows-powershell' | 'cmd';

export interface WindowsPtyShell {
  executable: string;
  kind: WindowsPtyShellKind;
}

type PowerShellVersionProbe = (executable: string, env: Record<string, string>) => number | null;

function readPowerShellMajorVersion(executable: string, env: Record<string, string>): number | null {
  try {
    const output = execFileSync(
      executable,
      ['-NoLogo', '-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'],
      {
        encoding: 'utf8',
        env,
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 3000,
        windowsHide: true,
      },
    ).trim();
    const major = Number.parseInt(output, 10);
    return Number.isFinite(major) ? major : null;
  } catch {
    return null;
  }
}

function getEnvironmentValue(env: Record<string, string>, name: string): string | undefined {
  const entry = Object.entries(env).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry?.[1];
}

/** Prefer PowerShell 7+, then Windows PowerShell, with cmd.exe as the final fallback. */
export function resolveWindowsPtyShell(
  env: Record<string, string>,
  probeVersion: PowerShellVersionProbe = readPowerShellMajorVersion,
): WindowsPtyShell {
  const pwsh = resolveCommandPath('pwsh', env, 'win32');
  if (pwsh && (probeVersion(pwsh, env) ?? 0) >= 7) {
    return { executable: pwsh, kind: 'pwsh' };
  }

  const windowsPowerShell = resolveCommandPath('powershell', env, 'win32');
  if (windowsPowerShell) {
    return { executable: windowsPowerShell, kind: 'windows-powershell' };
  }

  const commandPrompt = resolveCommandPath('cmd', env, 'win32')
    ?? getEnvironmentValue(env, 'ComSpec')
    ?? 'cmd.exe';
  return { executable: commandPrompt, kind: 'cmd' };
}

function quotePowerShellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Build a PowerShell call-expression without allowing paths or arguments to become script. */
export function buildPowerShellAgentCommand(agentPath: string, args: string[]): string {
  return `& ${[agentPath, ...args].map(quotePowerShellLiteral).join(' ')}`;
}
