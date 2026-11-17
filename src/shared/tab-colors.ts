/** Claude Code's `/color` palette, so a tab matches the colour its session shows. */
export const TAB_COLOR_OPTIONS = [
  { name: 'red', label: 'Red', value: '#dc2626' },
  { name: 'orange', label: 'Orange', value: '#d97757' },
  { name: 'yellow', label: 'Yellow', value: '#ca8a04' },
  { name: 'green', label: 'Green', value: '#16a34a' },
  { name: 'cyan', label: 'Cyan', value: '#0891b2' },
  { name: 'blue', label: 'Blue', value: '#6a9bcc' },
  { name: 'purple', label: 'Purple', value: '#827dbd' },
  { name: 'pink', label: 'Pink', value: '#c46686' },
] as const;

const optionValues: Record<string, string> = Object.fromEntries(TAB_COLOR_OPTIONS.map(option => [option.name, option.value]));

const NAMED_COLOR_MAP: Record<string, string> = {
  ...optionValues,
  teal: optionValues.cyan,
  sapphire: '#74c7ec',
  sky: '#89dceb',
  lavender: '#b4befe',
  magenta: optionValues.pink,
  mauve: optionValues.purple,
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
