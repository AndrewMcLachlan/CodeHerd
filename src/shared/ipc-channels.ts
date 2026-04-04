export const IPC = {
  // Renderer -> Main (invoke pattern)
  TAB_CREATE: 'tab:create',
  TAB_CLOSE: 'tab:close',
  TAB_RESIZE: 'tab:resize',
  TAB_INPUT: 'tab:input',
  TAB_GET_ALL: 'tab:get-all',
  TAB_REORDER: 'tab:reorder',
  SESSION_LIST: 'session:list',
  FOLDER_PICK: 'folder:pick',
  STATE_GET: 'state:get',
  CLIPBOARD_WRITE: 'clipboard:write',
  CLIPBOARD_READ: 'clipboard:read',
  GIT_INFO: 'git:info',
  SIDEBAR_STATE: 'sidebar:state',
  RECENTLY_CLOSED: 'recently-closed:save',
  MENU_ACTION: 'menu:action',
  PREFERENCES_GET: 'preferences:get',
  PREFERENCES_SAVE: 'preferences:save',
  THEME_GET_RESOLVED: 'theme:get-resolved',
  SHELL_OPEN_EXTERNAL: 'shell:open-external',

  // Main -> Renderer (send pattern)
  PTY_DATA: 'pty:data',
  PTY_EXIT: 'pty:exit',
  TAB_STATUS: 'tab:status',
  THEME_CHANGED: 'theme:changed',
  MENU_RESTORE_RECENT: 'menu:restore-recent',
} as const;
