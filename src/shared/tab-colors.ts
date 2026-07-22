export const TAB_COLOR_OPTIONS = [
  { name: 'red', label: 'Red', value: '#f38ba8' },
  { name: 'orange', label: 'Orange', value: '#fab387' },
  { name: 'yellow', label: 'Yellow', value: '#f9e2af' },
  { name: 'green', label: 'Green', value: '#a6e3a1' },
  { name: 'cyan', label: 'Cyan', value: '#94e2d5' },
  { name: 'blue', label: 'Blue', value: '#89b4fa' },
  { name: 'purple', label: 'Purple', value: '#cba6f7' },
  { name: 'pink', label: 'Pink', value: '#f5c2e7' },
] as const;

const NAMED_COLOR_MAP: Record<string, string> = {
  ...Object.fromEntries(TAB_COLOR_OPTIONS.map(option => [option.name, option.value])),
  teal: '#94e2d5',
  sapphire: '#74c7ec',
  sky: '#89dceb',
  lavender: '#b4befe',
  magenta: '#f5c2e7',
  mauve: '#cba6f7',
  white: '#cdd6f4',
  gray: '#6c7086',
  grey: '#6c7086',
};

export function resolveTabColor(value: string): string {
  return NAMED_COLOR_MAP[value.toLowerCase()] ?? value;
}
/** Normalise a supported named or hexadecimal tab colour; undefined means invalid. */
export function normalizeTabColor(value: string): string | undefined {
  const trimmed = value.trim().toLowerCase();
  if (trimmed in NAMED_COLOR_MAP) return trimmed;
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/.test(trimmed)) return trimmed;
  return undefined;
}
