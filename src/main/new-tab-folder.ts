import * as fs from 'fs';
import type { Preferences } from '../shared/types';

/** Whether a path is a directory that still exists. Injected so tests stay off disk. */
export type FolderExists = (folder: string) => boolean;

const onDisk: FolderExists = (folder) => {
  try {
    return fs.statSync(folder).isDirectory();
  } catch {
    return false;
  }
};

/**
 * Where the new-tab folder dialog should open.
 *
 * Returns undefined when there is nothing sensible to offer, which leaves
 * showOpenDialog's defaultPath unset and hands the choice back to the platform.
 * A path that no longer exists counts as nothing: passing a deleted or renamed
 * folder does not raise an error, it just drops the dialog somewhere unhelpful.
 */
export function resolveNewTabFolder(
  prefs: Preferences,
  lastFolder: string | null,
  exists: FolderExists = onDisk,
): string | undefined {
  // Preferences saved before this setting existed have no mode, and getPreferences()
  // returns what was stored rather than merging in new defaults.
  const candidate = prefs.newTabFolderMode === 'fixed' ? prefs.newTabFolder : lastFolder;
  const folder = candidate?.trim();
  if (!folder) return undefined;
  return exists(folder) ? folder : undefined;
}
