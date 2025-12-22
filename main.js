

const { app, BrowserWindow, ipcMain, Tray, Menu, dialog } = require('electron');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const autoLauncher = require('./auto-launch');
const db = require('./db');
const { addTodosFromEmailTodos } = require('./email_todo_flag');
const setupMailIpc = require('./mail'); // mail.js 모듈 로드

// 마감일 직접 입력 IPC
ipcMain.handle('set-todo-deadline', (event, id, deadline) => {
  try {
    // dday 계산
    let ddayValue = 0;
    if (deadline) {
      const now = new Date();
      const target = new Date(deadline);
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const diffTime = target - today;
      ddayValue = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }
    db.prepare('UPDATE todos SET deadline = ?, dday = ? WHERE id = ?').run(deadline, ddayValue, id);
    return { success: true };
  } catch (err) {
    console.error('set-todo-deadline error:', err);
    return { success: false, error: err.message };
  }
});
// delemail 테이블 생성 (없으면)
try {
  db.prepare(`CREATE TABLE IF NOT EXISTS delemail (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    received_at TEXT,
    subject TEXT,
    body TEXT,
    from_addr TEXT,
    todo_flag INTEGER,
    unique_hash TEXT,
    deadline TEXT,
    created_at TEXT
  )`).run();
} catch (e) {}

// emails 테이블에서 할일 분류된 것 todos로, 아닌 것 delemail로 옮기는 함수
async function moveEmailTodos() {
  // 할일로 분류된 메일
  const todoMails = db.prepare('SELECT * FROM emails WHERE todo_flag = 1').all();
  todoMails.forEach(mail => {
    db.prepare('INSERT INTO todos (date, dday, task, memo, deadline, mail_flag) VALUES (?, ?, ?, ?, ?, ?)').run(
      mail.received_at || '',
      '',
      mail.subject || '',
      mail.memo || '',
      mail.deadline || '',
      'Y'
    );
    db.prepare('DELETE FROM emails WHERE id = ?').run(mail.id);
  });
  // 할일로 분류되지 않은 메일
  const delMails = db.prepare('SELECT * FROM emails WHERE todo_flag != 1').all();
  delMails.forEach(mail => {
    db.prepare('INSERT INTO delemail (subject, body, from_addr, received_at, memo, deadline) VALUES (?, ?, ?, ?, ?, ?)').run(
      mail.subject || '',
      mail.body || '',
      mail.from_addr || '',
      mail.received_at || '',
      mail.memo || '',
      mail.deadline || ''
    );
    db.prepare('DELETE FROM emails WHERE id = ?').run(mail.id);
  });
}


// 메일 목록 새창 오픈 (main.html에서 독립적으로)
ipcMain.on('open-emails', () => {
  const mailListWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true
    },
    title: '메일 목록',
    autoHideMenuBar: true,
  });
  mailListWindow.loadFile('mail-list.html');
});
// 환경설정 저장된 메일 연동정보 반환
ipcMain.handle('get-mail-settings', (event) => {
  try {
    const row = db.prepare('SELECT * FROM mail_settings WHERE id=1').get();
    if (!row) return {};
    // camelCase로 반환
    return {
      protocol: row.protocol,
      mailId: row.mail_id,
      mailPw: row.mail_pw,
      host: row.host,
      port: row.port,
      mailSince: row.mail_since
    };
  } catch (err) {
    console.error('get-mail-settings error:', err);
    return {};
  }
});

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
  // 제외 처리 및 제목을 제외키워드로 저장
  const todo = db.prepare('SELECT * FROM todos WHERE id = ?').get(id);
  if (todo && todo.task) {
    // keywords 테이블에 제외키워드로 저장 (word, type)
    try {
      db.prepare('INSERT OR IGNORE INTO keywords (word, type) VALUES (?, ?)').run(todo.task, 'exclude');
    } catch (e) {}
  }
  db.prepare('UPDATE todos SET todo_flag = 0 WHERE id = ?').run(id);
  return { success: true };
// keywords 테이블에 type 컬럼 추가 (없으면)
try {
  const pragma = db.prepare('PRAGMA table_info(keywords)').all();
  if (!pragma.some(col => col.name === 'type')) {
    db.exec('ALTER TABLE keywords ADD COLUMN type TEXT');
  }
} catch (e) {}

// 할일 분류 시 제외키워드 참고 (email_todo_flag.js 등에서 활용)
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
        // 동기화 전 emails 테이블의 최신 메일 id 저장
        const lastEmail = db.prepare('SELECT id FROM emails ORDER BY id DESC LIMIT 1').get();
        await mailModule.syncMail(row);
        if (mainWindow) mainWindow.webContents.send('mail-sync-complete');
        // 동기화 후 새로 들어온 모든 메일에 대해 알림
        const newEmails = lastEmail && lastEmail.id
          ? db.prepare('SELECT subject, from_addr, received_at FROM emails WHERE id > ? ORDER BY id ASC').all(lastEmail.id)
          : db.prepare('SELECT subject, from_addr, received_at FROM emails ORDER BY id ASC LIMIT 1').all();
        if (newEmails && newEmails.length > 0 && tray) {
          let delay = 0;
          newEmails.forEach(email => {
            setTimeout(() => showTrayPopup(email), delay);
            delay += 3000;
          });
        }
      }
    }
  } catch (err) {
    console.error('Sync Mail Error:', err);
  }
}

app.whenReady().then(() => {
      // 앱 시작 시 또는 동기화 후 emails 분류 및 이동
      moveEmailTodos();
    // 트레이 팝업(Toast) 함수 정의
    global.showTrayPopup = function(email) {
      const popup = new BrowserWindow({
        width: 320,
        height: 90,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        transparent: true,
        show: false,
        webPreferences: { contextIsolation: true }
      });
      // 트레이 위치 계산 (Windows 기준)
      const trayBounds = tray.getBounds();
      const x = trayBounds.x - 120;
      const y = trayBounds.y - 100;
      popup.setPosition(x, y, false);
      popup.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`
        <body style="margin:0;padding:0;background:rgba(0,180,154,0.97);border-radius:12px;font-family:'Segoe UI','Malgun Gothic',Arial,sans-serif;box-shadow:0 4px 24px #00b49a44;">
          <div style="padding:16px 18px 12px 18px;color:#fff;">
            <div style="font-size:1em;font-weight:bold;">새 메일 도착!</div>
            <div style="margin-top:6px;font-size:0.98em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"><b>${email.subject}</b></div>
            <div style="font-size:0.92em;margin-top:2px;">${email.from_addr}</div>
            <div style="font-size:0.85em;color:#e0f7fa;margin-top:2px;">${email.received_at}</div>
          </div>
        </body>
    
      `));
      popup.once('ready-to-show', () => popup.show());
      setTimeout(() => { if (!popup.isDestroyed()) popup.close(); }, 3000);
    };
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
    console.log('주기적 동기화 시작...');
    await syncMail();
    addTodosFromEmailTodos(); // 이메일 flag 기반 할일 추가 로직 실행
    // [추가] 렌더러 프로세스에 데이터 갱신 신호 전송
    if (mainWindow) {
      mainWindow.webContents.send('refresh-all-lists');
    }
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