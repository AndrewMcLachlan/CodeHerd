export const IPC = {
  // Renderer -> Main (invoke pattern)
  TAB_CREATE: 'tab:create',
  TAB_CLOSE: 'tab:close',
  TAB_RESIZE: 'tab:resize',
  TAB_INPUT: 'tab:input',
  TAB_GET_ALL: 'tab:get-all',
  SESSION_LIST: 'session:list',
  FOLDER_PICK: 'folder:pick',
  STATE_GET: 'state:get',
  CLIPBOARD_WRITE: 'clipboard:write',
  CLIPBOARD_READ: 'clipboard:read',
  GIT_INFO: 'git:info',
  SIDEBAR_STATE: 'sidebar:state',
  RECENTLY_CLOSED: 'recently-closed:save',
  MENU_ACTION: 'menu:action',

  // Main -> Renderer (send pattern)
  PTY_DATA: 'pty:data',
  PTY_EXIT: 'pty:exit',
  TAB_STATUS: 'tab:status',
} as const;
