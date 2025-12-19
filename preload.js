const { contextBridge, ipcRenderer } = require('electron');


contextBridge.exposeInMainWorld('electronAPI', {
    addTodoFromMail: (mailId) => ipcRenderer.invoke('add-todo-from-mail', mailId),
  minimize: () => ipcRenderer.send('minimize'),
  close: () => ipcRenderer.send('close'),
  getTodos: () => ipcRenderer.invoke('get-todos'),
  openSettings: () => ipcRenderer.send('open-settings'),
  openKeyword: () => ipcRenderer.send('open-keyword'),
  getKeywords: () => ipcRenderer.invoke('get-keywords'),
  insertKeyword: (kw) => ipcRenderer.invoke('insert-keyword', kw),
  updateKeyword: (oldKw, newKw) => ipcRenderer.invoke('update-keyword', oldKw, newKw),
  deleteKeyword: (kw) => ipcRenderer.invoke('delete-keyword', kw),
  mailConnect: (info) => ipcRenderer.invoke('mail-connect', info),
  getEmails: () => ipcRenderer.invoke('get-emails'),
  openEmails: () => ipcRenderer.send('open-emails'),
  setEmailTodoFlag: (id, flag) => ipcRenderer.invoke('set-email-todo-flag', id, flag),
  excludeTodo: (id) => ipcRenderer.invoke('exclude-todo', id),
  setEmailTodoComplete: (id) => ipcRenderer.invoke('set-email-todo-complete', id),
  refreshTodosFromEmails: () => ipcRenderer.invoke('refresh-todos-from-emails'),
  getMailSettings: () => ipcRenderer.invoke('get-mail-settings'),
  saveMailSettings: (settings) => ipcRenderer.invoke('save-mail-settings', settings),
  saveMemo: (id, memo) => ipcRenderer.invoke('save-memo', id, memo),
  insertTodo: (todo) => ipcRenderer.invoke('insert-todo', todo),
  openAppSettings: () => ipcRenderer.send('open-app-settings'),
  getAutoLaunch: () => ipcRenderer.invoke('get-auto-launch'),
  setAutoLaunch: (enable) => ipcRenderer.invoke('set-auto-launch', enable),
  deleteAllTodos: () => ipcRenderer.invoke('delete-all-todos'),
  startMailSync: () => ipcRenderer.invoke('start-mail-sync'),
  stopMailSync: () => ipcRenderer.invoke('stop-mail-sync'),
  openMailDetail: (params) => ipcRenderer.send('open-mail-detail', params)
});
