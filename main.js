const { app, BrowserWindow, ipcMain, Tray, Menu, dialog } = require('electron');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const autoLauncher = require('./auto-launch');
const db = require('./db');
const { addTodosFromEmailTodos } = require('./email_todo_flag');
const setupMailIpc = require('./mail'); // mail.js 모듈 로드

let mainWindow = null;
let tray = null;

// OS별 아이콘 경로 설정
const iconPath = process.platform === 'darwin'
  ? path.join(__dirname, 'assets', 'icon.png')
  : path.join(__dirname, 'icon.ico');

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
    console.error('get-todos error:', err);
    return [];
  }
});

ipcMain.handle('insert-todo', (event, { task, deadline, memo }) => {
  try {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 19).replace('T', ' ');
    // dday 계산 로직
    let ddayValue = 0;
    if (deadline) {
      const target = new Date(deadline);
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const diffTime = target - today;
      ddayValue = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }

    // dday 컬럼을 포함하여 INSERT (테이블 제약 조건 충족)
    const stmt = db.prepare(`
      INSERT INTO todos (date, task, memo, deadline, dday, todo_flag)
      VALUES (?, ?, ?, ?, ?, 1)
    `);
    stmt.run(dateStr, task, memo || '', deadline || '', ddayValue);
    return { success: true };
  } catch (err) {
    console.error('insert-todo error:', err);
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

// 2. 키워드 관련
ipcMain.handle('get-keywords', async () => {
  return db.prepare("SELECT id, word FROM keywords").all();
});

ipcMain.handle('insert-keyword', (event, keyword) => {
  try {
    db.prepare('INSERT INTO keywords (word) VALUES (?)').run(keyword);
    // 키워드 포함 메일 즉시 업데이트
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
    
    // 설정 저장 후 즉시 동기화 시도
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

ipcMain.on('close', () => { if (mainWindow) mainWindow.close(); });
ipcMain.on('minimize', () => { if (mainWindow) mainWindow.minimize(); });

// --- 메인 함수 및 동기화 로직 ---

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200, height: 800, frame: false, transparent: true, alwaysOnTop: true,
    webPreferences: { 
      preload: path.join(__dirname, 'preload.js'), 
      contextIsolation: true,
      nodeIntegration: false 
    }
  });
  mainWindow.loadFile('main.html');
}

async function syncMail() {
  try {
    const row = db.prepare('SELECT * FROM mail_settings WHERE id=1').get();
    if (row && row.mail_id && row.mail_pw) {
      const mailModule = require('./mail');
      if (typeof mailModule.syncMail === 'function') {
        await mailModule.syncMail(row);
        if (mainWindow) mainWindow.webContents.send('mail-sync-complete');
      }
    }
  } catch (err) {
    console.error('Sync Mail Error:', err);
  }
}

app.whenReady().then(() => {
  // 1. mail.js의 핸들러 등록 (mail-connect 등)
  setupMailIpc(mainWindow);

  createWindow();
  
  // 트레이 설정
  tray = new Tray(iconPath);
  tray.setToolTip('할일 위젯');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '열기', click: () => { if (mainWindow) mainWindow.show(); } },
    { label: '종료', click: () => app.quit() }
  ]));

  // 주기적 메일 분석 및 동기화 (1분마다)
  setInterval(async () => {
    await syncMail();
    addTodosFromEmailTodos(); // 이메일 flag 기반 할일 추가 로직 실행
  }, 60000);

  // 초기 실행 시 동기화
  syncMail();
});

// 에러 핸들링
process.on('uncaughtException', (err) => {
  if (err.code === 'ECONNRESET') return; 
  console.error('System Error:', err);
});

app.on('window-all-closed', (e) => {
  if (process.platform !== 'darwin') app.quit();
});