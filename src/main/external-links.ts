import { shell } from 'electron';
import type { WebContents } from 'electron';

/**
 * Whether a URL may be handed to the operating system.
 *
 * Only http and https. `shell.openExternal` asks the OS to run whatever is
 * registered for the scheme, so anything wider is a way to launch arbitrary
 * local handlers from text the agent happened to print — `file:`, `smb:`, and
 * app-registered schemes all reach real software. Parsed rather than prefix
 * matched so case and surrounding whitespace cannot slip past.
 */
export function isSafeExternalUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return false;
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}

/** Open a URL in the user's default browser, ignoring anything unsafe. */
export function openExternal(url: string): void {
  if (isSafeExternalUrl(url)) void shell.openExternal(url);
}

/**
 * A navigation that stays inside the app's own bundled pages. The renderer is
 * loaded with loadFile, so its own pages are file: URLs; anything else is the
 * outside world and belongs in a browser.
 */
function isInternalNavigation(url: string): boolean {
  return url.startsWith('file://');
}

/**
 * Send every link that would otherwise move or replace a window to the default
 * browser instead.
 *
 * Two separate escapes exist by default in Electron and neither reaches the
 * browser on its own:
 *
 *  - `window.open` and `target="_blank"` open a brand new BrowserWindow. Ours are
 *    frameless, so that window would have no address bar, no back button, and no
 *    way to tell what site is being shown.
 *  - A plain navigation — most easily triggered by dragging a link or file onto
 *    the window — replaces the loaded page. The whole UI is gone, with terminals
 *    still running behind it, until the app is restarted.
 *
 * Both are denied here and routed to the OS instead.
 */
export function routeLinksToBrowser(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event, url) => {
    if (isInternalNavigation(url)) return;
    event.preventDefault();
    openExternal(url);
  });
}
