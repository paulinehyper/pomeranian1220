const { app, BrowserWindow, ipcMain, Tray, Menu, dialog } = require('electron');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const autoLauncher = require('./auto-launch');
const db = require('./db');
const { addTodosFromEmailTodos } = require('./email_todo_flag');

let mainWindow = null;
let appSettingsWindow = null;
let emailsWindow = null;
let keywordWindow = null;
let tray = null;
let syncMailInterval = null;

// OS별 아이콘 경로 설정
const iconPath = process.platform === 'darwin'
  ? path.join(__dirname, 'assets', 'icon.png')
  : path.join(__dirname, 'icon.ico');
const winIcon = iconPath;

// --- 유틸리티 함수 ---
const extractDeadline = (body) => {
  if (!body) return null;
  const patterns = [
    /(\d{4})[./-](\d{1,2})[./-](\d{1,2})/,
    /(\d{1,2})[./-](\d{1,2})/,
    /(\d{1,2})월\s?(\d{1,2})일/,
    /(\d{1,2})일/,
    /(\d{1,2})일까지/
  ];
  for (const re of patterns) {
    const m = body.match(re);
    if (m) {
      if (m.length >= 4 && m[1].length === 4) return `${m[1]}/${m[2].padStart(2, '0')}/${m[3].padStart(2, '0')}`;
      return `${new Date().getFullYear()}/${(m[1] || '').padStart(2, '0')}/${(m[2] || '01').padStart(2, '0')}`;
    }
  }
  return null;
};

// --- IPC 핸들러 등록 ---

// 1. 할일 관련
ipcMain.handle('get-todos', (event, mode) => {
  try {
    let todos;
    if (mode === 'trash') {
      todos = db.prepare('SELECT * FROM todos WHERE todo_flag = 3 ORDER BY id DESC').all();
    } else {
      todos = db.prepare('SELECT * FROM todos WHERE todo_flag IN (1, 2) ORDER BY id').all();
    }
    return todos.map(t => ({
      id: t.id,
      task: t.task || t.content || '제목 없음',
      memo: t.memo || '',
      deadline: t.deadline || '없음',
      todo_flag: t.todo_flag
    }));
  } catch (err) {
    return [];
  }
});

ipcMain.handle('insert-todo', (event, { task, deadline, memo }) => {
  try {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 19).replace('T', ' ');
    db.prepare('INSERT INTO todos (date, task, memo, deadline, todo_flag) VALUES (?, ?, ?, ?, 1)')
      .run(dateStr, task, memo || '', deadline || '');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('set-todo-complete', (event, id, flag) => {
  db.prepare('UPDATE todos SET todo_flag = ? WHERE id = ?').run(flag, id);
  return { success: true };
});

ipcMain.handle('exclude-todo', (event, id) => {
  db.prepare('UPDATE todos SET todo_flag = 0 WHERE id = ?').run(id);
  return { success: true };
});

// 2. 키워드 관련 (중복 제거 및 통합)
ipcMain.handle('get-keywords', async () => {
  return db.prepare("SELECT id, word FROM keywords").all();
});

ipcMain.handle('insert-keyword', (event, keyword) => {
  try {
    db.prepare('INSERT INTO keywords (word) VALUES (?)').run(keyword);
    // 키워드가 포함된 메일을 자동으로 할일(todo_flag=1)로 변경
    db.prepare('UPDATE emails SET todo_flag = 1 WHERE subject LIKE ?').run(`%${keyword}%`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('delete-keyword', (event, id) => {
  try {
    db.prepare('DELETE FROM keywords WHERE id = ?').run(id);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 3. 이메일 및 설정 관련
ipcMain.handle('get-emails', () => {
  return db.prepare('SELECT * FROM emails ORDER BY id DESC').all();
});

ipcMain.handle('save-mail-settings', (event, settings) => {
  try {
    const stmt = db.prepare(`
      INSERT INTO mail_settings (id, protocol, mail_id, mail_pw, host, port, mail_since) 
      VALUES (1, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET 
        protocol=excluded.protocol, mail_id=excluded.mail_id, mail_pw=excluded.mail_pw, 
        host=excluded.host, port=excluded.port, mail_since=excluded.mail_since
    `);
    stmt.run(settings.protocol, settings.mailId, settings.mailPw, settings.host, settings.port, settings.mailSince);
    setTimeout(() => syncMail(), 1000);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 4. 창 제어 관련
ipcMain.on('open-mail-detail', (event, params) => {
  if (!mainWindow) return;
  const detailWindow = new BrowserWindow({
    width: 700, height: 600, frame: false, alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  detailWindow.loadURL(`file://${__dirname}/mail-detail.html?${params}`);
});

ipcMain.on('close', () => mainWindow.close());
ipcMain.on('minimize', () => mainWindow.minimize());

// --- 메인 함수 및 동기화 로직 ---

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200, height: 800, frame: false, transparent: true, alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  mainWindow.loadFile('main.html');
}

async function syncMail() {
  const row = db.prepare('SELECT * FROM mail_settings WHERE id=1').get();
  if (row && row.mail_id && row.mail_pw) {
    const mailModule = require('./mail');
    if (typeof mailModule.syncMail === 'function') {
      await mailModule.syncMail(row);
      if (mainWindow) mainWindow.webContents.send('mail-sync-complete');
    }
  }
}

app.whenReady().then(() => {
  createWindow();
  
  // 트레이 설정
  tray = new Tray(iconPath);
  tray.setToolTip('할일 위젯');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '열기', click: () => mainWindow.show() },
    { label: '종료', click: () => app.quit() }
  ]));

  // 주기적 메일 분석 및 동기화 (1분마다)
  setInterval(async () => {
    await syncMail();
    addTodosFromEmailTodos(); // 이메일 flag 기반 할일 추가
  }, 60000);

  syncMail();
});

// 에러 핸들링
process.on('uncaughtException', (err) => {
  if (err.code === 'ECONNRESET') return; 
  console.error('System Error:', err);
});

app.on('window-all-closed', (e) => e.preventDefault());