const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // --- (A) 할일 관련 (Todo) ---
    getTodos: (all) => ipcRenderer.invoke('get-todos', all),
    insertTodo: (todo) => ipcRenderer.invoke('insert-todo', todo),
    setTodoDeadline: (id, deadline) => ipcRenderer.invoke('set-todo-deadline', id, deadline),
    setTodoComplete: (id, flag) => ipcRenderer.invoke('set-todo-complete', id, flag),
    setMailComplete: (id, flag) => ipcRenderer.invoke('set-mail-complete', id, flag),
    excludeTodo: (id, isEmail) => ipcRenderer.invoke('exclude-todo', id, isEmail),
    deleteAllTodos: () => ipcRenderer.invoke('delete-all-todos'),
    saveMemo: (id, memo) => ipcRenderer.invoke('save-memo', id, memo),

    // --- (B) 이메일 관련 (Mail) ---
    getTodoEmails: () => ipcRenderer.invoke('get-todo-emails'), // 위치 수정됨
    addTodoFromMail: (mailId) => ipcRenderer.invoke('add-todo-from-mail', mailId),
    mailConnect: (info) => ipcRenderer.invoke('mail-connect', info),
    getEmails: () => ipcRenderer.invoke('get-emails'),
    openEmails: () => ipcRenderer.send('open-emails'),
    setEmailTodoFlag: (id, flag) => ipcRenderer.invoke('set-email-todo-flag', id, flag),
    setEmailTodoComplete: (id) => ipcRenderer.invoke('set-email-todo-complete', id),
    refreshTodosFromEmails: () => ipcRenderer.invoke('refresh-todos-from-emails'),
    getMailSettings: () => ipcRenderer.invoke('get-mail-settings'),
    saveMailSettings: (settings) => ipcRenderer.invoke('save-mail-settings', settings),
    startMailSync: () => ipcRenderer.invoke('start-mail-sync'),
    stopMailSync: () => ipcRenderer.invoke('stop-mail-sync'),
    openMailDetail: (params) => ipcRenderer.send('open-mail-detail', params),

    // --- (C) 키워드 관련 (Keyword) ---
    openKeyword: () => ipcRenderer.send('open-keyword'),
    getKeywords: () => ipcRenderer.invoke('get-keywords'),
    insertKeyword: (word, type) => ipcRenderer.invoke('insert-keyword', { word, type }),
    updateKeyword: (oldKw, newKw) => ipcRenderer.invoke('update-keyword', oldKw, newKw),
    deleteKeyword: (kw) => ipcRenderer.invoke('delete-keyword', kw),

    // --- (D) 앱 설정 및 시스템 ---
    minimize: () => ipcRenderer.send('minimize'),
    close: () => ipcRenderer.send('close'),
    openSettings: () => ipcRenderer.send('open-settings'),
    openAppSettings: () => ipcRenderer.send('open-app-settings'),
    getAutoLaunch: () => ipcRenderer.invoke('get-auto-launch'),
    setAutoLaunch: (enable) => ipcRenderer.invoke('set-auto-launch', enable),

    // --- (E) 이벤트 수신 (Main -> Renderer) ---
    // 중요: 리스너가 중복 등록되지 않도록 정리하는 기능이 포함된 형태 권장
    onNewTodoAdded: (callback) => {
        const subscription = (event, ...args) => callback(...args);
        ipcRenderer.on('new-todo-added', subscription);
        return () => ipcRenderer.removeListener('new-todo-added', subscription);
    }
});