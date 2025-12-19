const { app, BrowserWindow, ipcMain, Tray, Menu } = require('electron');
const path = require('path');
const autoLauncher = require('./auto-launch');
const db = require('./db');
const { addTodosFromEmailTodos } = require('./email_todo_flag');

// 이메일 id를 받아 해당 메일을 todo로 분류하는 IPC
ipcMain.handle('add-todo-from-mail', (event, mailId) => {
  try {
    // 1. 해당 메일 todo_flag=1로 변경
    db.prepare('UPDATE emails SET todo_flag=1 WHERE id=?').run(mailId);
    // 2. 해당 메일을 todos에 추가 (중복 방지)
    const mail = db.prepare('SELECT subject, body, deadline, unique_hash FROM emails WHERE id=?').get(mailId);
    if (!mail) return { success: false, error: '메일을 찾을 수 없음' };
    // unique_hash가 없으면 메일 기반 아님(추가 안함)
    if (!mail.unique_hash) return { success: false, error: '메일 기반이 아님' };
    const exists = db.prepare('SELECT COUNT(*) as cnt FROM todos WHERE task = ? AND todo_flag = 1').get(mail.subject).cnt;
    if (exists === 0) {
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      db.prepare('INSERT INTO todos (date, dday, task, memo, deadline, todo_flag, unique_hash) VALUES (?, ?, ?, ?, ?, 1, ?)')
        .run(today, '', mail.subject, mail.body || '', mail.deadline || '', mail.unique_hash);
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ...require 구문들...
// ...existing code...

// ...existing code...
// ...existing code...
// ...중복 require 제거, 아래에서 한 번만 선언...
// ...중복 require 제거, 아래에서 한 번만 선언...
// ...중복 require 제거, 아래에서 한 번만 선언...
// 아래 require들은 Electron 객체 선언 이후에 위치해야 안전
// ...중복 require 제거, 아래에서 한 번만 선언...
// ...중복 require 제거, 아래에서 한 번만 선언...
// ...중복 require 제거, 아래에서 한 번만 선언...
// ...중복 require 제거, 아래에서 한 번만 선언...
// ...중복 require 제거, 아래에서 한 번만 선언...
// 아래 require들은 Electron 객체 선언 이후에 위치해야 안전
// ...중복 require 제거, 아래에서 한 번만 선언...
// ...중복 require 제거, 아래에서 한 번만 선언...

// 메일 상세보기 창을 mainWindow 오른쪽에 띄우는 IPC 핸들러
ipcMain.on('open-mail-detail', (event, params) => {
  if (!mainWindow) return;
  const bounds = mainWindow.getBounds();
  const detailWindow = new BrowserWindow({
    width: 700,
    height: 600,
    x: bounds.x + 10,
    y: bounds.y,
    frame: false,
    resizable: true,
    movable: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  detailWindow.loadURL(`file://${__dirname}/mail-detail.html?${params}`);
  detailWindow.on('closed', () => {});
});


// get-todos, get-emails 핸들러는 앱 시작 시 한 번만 등록
ipcMain.handle('get-todos', () => {
  // todo_flag=1(할일) 중 메일 기반(unique_hash 존재) + 키워드 포함된 subject만 반환
  const todos = db.prepare('SELECT * FROM todos WHERE todo_flag=1 ORDER BY id').all();
  const keywords = db.getAllKeywords ? db.getAllKeywords() : [];
  const now = new Date();
  // 메일 기반(unique_hash) + 키워드 포함 subject만 필터링
  const filtered = todos.filter(todo => {
    if (!todo.unique_hash) return false;
    if (!keywords.length) return false;
    return keywords.some(kw => todo.task && todo.task.includes(kw));
  });
  return filtered.map(todo => {
    let deadline = todo.deadline;
    let dday = '없음';
    let date = '없음';
    if (deadline) {
      date = deadline.replace(/\//g, '/');
      const deadlineDate = new Date(date);
      if (!isNaN(deadlineDate)) {
        const diff = Math.ceil((deadlineDate - now) / (1000*60*60*24));
        dday = diff >= 0 ? `D-${diff}` : `D+${Math.abs(diff)}`;
      }
    }
    return {
      id: todo.id,
      date,
      dday,
      task: todo.task,
      deadline: deadline || '없음',
      memo: todo.memo || '',
      todo_flag: todo.todo_flag // 완료 여부 반환
    };
  });
});

ipcMain.handle('get-emails', () => {
  const rows = db.prepare('SELECT * FROM emails ORDER BY id DESC').all();
  return rows;
});

// 새로고침 시 이메일 todo를 todos에 추가
ipcMain.handle('refresh-todos-from-emails', () => {
  try {
    addTodosFromEmailTodos();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 전체 할일 삭제
ipcMain.handle('delete-all-todos', () => {
  db.prepare('DELETE FROM todos').run();
  return { success: true };
});

// 환경설정(app-settings.html) 창 열기
let appSettingsWindow = null;
ipcMain.on('open-app-settings', () => {
  if (appSettingsWindow && !appSettingsWindow.isDestroyed()) {
    appSettingsWindow.focus();
    return;
  }
  appSettingsWindow = new BrowserWindow({
    width: 600,
    height: 400,
    resizable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    frame: false, // 커스텀 프레임 적용
    title: '환경설정',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  appSettingsWindow.loadFile('app-settings.html');
  appSettingsWindow.on('closed', () => { appSettingsWindow = null; });
});

ipcMain.handle('get-auto-launch', async () => {
  try {
    const row = db.prepare('SELECT enabled FROM autoplay WHERE id=1').get();
    return !!(row && row.enabled);
  } catch (e) {
    return false;
  }
});
ipcMain.handle('set-auto-launch', async (event, enable) => {
  try {
    db.prepare('UPDATE autoplay SET enabled=? WHERE id=1').run(enable ? 1 : 0);
    if (enable) {
      await autoLauncher.enable();
    } else {
      await autoLauncher.disable();
    }
    return true;
  } catch (e) {
    return false;
  }
});

// 배포용: mail_settings 초기화 (mail_id, mail_pw, mail_since 비움) 및 자동실행 등록
app.once('ready', async () => {
  // 이메일 todo를 todos에 자동 추가
  try {
    addTodosFromEmailTodos();
  } catch (e) {
    console.error('이메일 todo를 todos에 추가하는 중 오류:', e);
  }
  try {
    // mail_settings 테이블이 비어있을 때만 기본값 삽입
    const count = db.prepare('SELECT COUNT(*) as cnt FROM mail_settings').get().cnt;
    if (count === 0) {
      db.prepare('INSERT INTO mail_settings (mail_type, protocol, mail_id, mail_pw, mail_since, mail_server) VALUES (?, ?, ?, ?, ?, ?)')
        .run('naver', 'imap-ssl', '', '', '', '');
    }
  } catch (e) {
    // 무시
  }
  // 자동실행 등록 (윈도우/맥 모두 지원)
  try {
    if (!(await autoLauncher.isEnabled())) {
      await autoLauncher.enable();
    }
  } catch (e) {
    // 무시 (권한 문제 등)
  }
});

// 할일 제외(숨김) 처리: todo_flag=0
ipcMain.handle('exclude-todo', (event, id) => {
  db.prepare('UPDATE todos SET todo_flag=0 WHERE id=?').run(id);
  // 학습데이터에서 해당 할일(메일 기반일 경우 subject+body 포함된 줄)도 삭제 및 negative 샘플로 저장
  try {
    // todos에서 unique_hash가 있으면 메일 기반임
    const todo = db.prepare('SELECT * FROM todos WHERE id=?').get(id);
    let negativeSample = '';
    if (todo && todo.unique_hash) {
      // emails에서 subject/body 찾기
      const mail = db.prepare('SELECT subject, body, id FROM emails WHERE unique_hash=?').get(todo.unique_hash);
      // 메일 기반 할일이면 emails 테이블의 todo_flag도 0으로 변경
      if (mail && mail.id) {
        db.prepare('UPDATE emails SET todo_flag=0 WHERE id=?').run(mail.id);
      }
      if (mail) {
        const fs = require('fs');
        const lines = fs.readFileSync('todo_train_data.txt', 'utf-8').split('\n');
        const filtered = lines.filter(line => {
          // subject 또는 body가 포함된 줄은 제외
          return !(line.includes(mail.subject) || line.includes(mail.body));
        });
        fs.writeFileSync('todo_train_data.txt', filtered.join('\n'));
        // negative 샘플로 저장 (예: __NEG__ [제목] [본문])
        negativeSample = `__NEG__ ${mail.subject} ${mail.body || ''}`.trim();
      }
    } else if (todo) {
      // 일반 할일도 negative 샘플로 저장
      negativeSample = `__NEG__ ${todo.task} ${todo.memo || ''}`.trim();
    }
    if (negativeSample) {
      const fs = require('fs');
      fs.appendFileSync('todo_train_data.txt', `\n${negativeSample}`);
    }
  } catch (e) { /* 무시 */ }
  return { success: true };
});

// OS별 아이콘 경로 분기
const iconPath =
  process.platform === 'darwin'
    ? path.join(__dirname, 'assets', 'icon.png')   // mac
    : path.join(__dirname, 'icon.ico');            // win
const winIcon = iconPath;

// 사용자 직접 할일 추가
ipcMain.handle('insert-todo', (event, { task, deadline, memo }) => {
  try {
    // deadline이 없으면 null, memo는 빈 문자열 허용, todo_flag=1로 저장
    db.prepare('INSERT INTO todos (date, dday, task, memo, deadline, todo_flag) VALUES (?, ?, ?, ?, ?, 1)')
      .run(deadline || '', '', task, memo || '', deadline || '');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
// 이메일 todo 완료 처리 (todo_flag=2)
ipcMain.handle('set-email-todo-complete', (event, id) => {
  db.prepare('UPDATE emails SET todo_flag = 2 WHERE id = ?').run(id);
  return { success: true };
});
let tray = null;
const setupMailIpc = require('./mail');
let mainWindow = null;
let settingsWindow = null;
let emailsWindow = null;
let keywordWindow = null;

// Keyword 창 열기
ipcMain.on('open-keyword', () => {
  if (keywordWindow && !keywordWindow.isDestroyed()) {
    keywordWindow.focus();
    return;
  }
  keywordWindow = new BrowserWindow({
    width: 420,
    height: 340,
    resizable: false,
    alwaysOnTop: true,
    frame: false, // 커스텀 프레임
    icon: winIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  keywordWindow.loadFile('keyword.html');
  keywordWindow.on('closed', () => { keywordWindow = null; });
});

// Keyword 저장
ipcMain.handle('insert-keyword', (event, keyword) => {
  try {
    db.insertKeyword(keyword);
    // 키워드가 포함된 메일 제목을 todo_flag=1로 분류
    const stmt = db.prepare('UPDATE emails SET todo_flag=1 WHERE subject LIKE ?');
    stmt.run(`%${keyword}%`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
// Keyword 전체 조회
ipcMain.handle('get-keywords', () => {
  try {
    const keywords = db.getAllKeywords();
    return { success: true, keywords };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
// Keyword 수정
ipcMain.handle('update-keyword', (event, oldKw, newKw) => {
  try {
    db.updateKeyword(oldKw, newKw);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
// Keyword 삭제
ipcMain.handle('delete-keyword', (event, kw) => {
  try {
    db.deleteKeyword(kw);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('save-memo', (event, id, memo) => {
  // id가 'mail-123' 형태면 emails, 아니면 todos
  if (typeof id === 'string' && id.startsWith('mail-')) {
    const mailId = id.replace('mail-', '');
    db.prepare('UPDATE emails SET memo = ? WHERE id = ?').run(memo, mailId);
  } else {
    db.prepare('UPDATE todos SET memo = ? WHERE id = ?').run(memo, id);
  }
  return { success: true };
});

ipcMain.handle('save-mail-settings', (event, settings) => {
  // Save mail_server and host as well
  const stmt = db.prepare(`INSERT INTO mail_settings (mail_type, protocol, mail_id, mail_pw, mail_since, mail_server, host) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  stmt.run(settings.mailType, settings.protocol, settings.mailId, settings.mailPw, settings.mailSince, settings.mailServer, settings.host);
  // 저장 후 바로 메일 연동 실행
  setTimeout(() => {
    if (typeof syncMail === 'function') syncMail();
  }, 100);
  return { success: true };
});

ipcMain.handle('get-mail-settings', () => {
  const row = db.prepare('SELECT * FROM mail_settings ORDER BY id DESC LIMIT 1').get();
  return row || null;
});

ipcMain.handle('set-email-todo-flag', (event, id, flag) => {
  db.prepare('UPDATE emails SET todo_flag = ? WHERE id = ?').run(flag, id);
  const mail = db.prepare('SELECT subject, body, deadline, from_addr FROM emails WHERE id = ?').get(id);
  if (flag == 1) {
    // 메일 본문+제목을 positive(할일) 샘플로 저장 및 todos에 insert
    if (mail) {
      // 중복 방지: subject+body+from_addr+deadline 해시
      const crypto = require('crypto');
      const hash = crypto.createHash('sha256').update((mail.subject||'')+(mail.body||'')+(mail.from_addr||'')+(mail.deadline||'')).digest('hex');
      const exists = db.prepare('SELECT COUNT(*) as cnt FROM todos WHERE unique_hash = ?').get(hash);
      if (exists.cnt === 0) {
        db.prepare('INSERT INTO todos (task, memo, deadline, unique_hash) VALUES (?, ?, ?, ?)').run(mail.subject, '', mail.deadline, hash);
      }
      // 학습 데이터 저장
      const fs = require('fs');
      const line = `1\t${(mail.subject || '').replace(/\t/g,' ')} ${(mail.body || '').replace(/\t/g,' ')}\n`;
      fs.appendFileSync('todo_train_data.txt', line);
    }
  } else if (flag == 0 && mail) {
    // unique_hash 계산 후 해당 메일 기반 todos 삭제
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update((mail.subject||'')+(mail.body||'')+(mail.from_addr||'')+(mail.deadline||'')).digest('hex');
    db.prepare('DELETE FROM todos WHERE unique_hash = ?').run(hash);
  }
  return { success: true };
});

ipcMain.on('open-emails', () => {
  if (emailsWindow && !emailsWindow.isDestroyed()) {
    emailsWindow.focus();
    return;
  }
  emailsWindow = new BrowserWindow({
    width: 700,
    height: 500,
    resizable: true,
    minimizable: true,
    maximizable: true,
    icon: winIcon,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  emailsWindow.loadFile('emails.html');
  emailsWindow.setAlwaysOnTop(true);
  emailsWindow.on('closed', () => { emailsWindow = null; });
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    minWidth: 600,
    height: 700,
    alwaysOnTop: true,
    frame: false,
    resizable: true,
    transparent: true,
    icon: winIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile('main.html');
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 트레이 아이콘 클릭 시 창 토글
  if (tray) {
    tray.on('click', () => {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
      }
    });
  }

  ipcMain.on('minimize', () => {
    mainWindow.minimize();
  });
  ipcMain.on('close', () => {
    mainWindow.close();
  });

  const extractDeadline = (body) => {
    if (!body) return null;
    // YYYY-MM-DD, YYYY/MM/DD, MM/DD, MM월DD일, 12일까지, 12일, 12/30 등 다양한 날짜 패턴
    const patterns = [
      /(\d{4})[./-](\d{1,2})[./-](\d{1,2})/, // 2025-12-30
      /(\d{1,2})[./-](\d{1,2})/, // 12-30
      /(\d{1,2})월\s?(\d{1,2})일/, // 12월 30일
      /(\d{1,2})일/, // 30일
      /(\d{1,2})일까지/ // 30일까지
    ];
    for (const re of patterns) {
      const m = body.match(re);
      if (m) {
        if (m.length >= 4 && m[1].length === 4) {
          // YYYY-MM-DD
          return `${m[1]}/${m[2].padStart(2,'0')}/${m[3].padStart(2,'0')}`;
        } else if (m.length >= 3 && re === patterns[1]) {
          // MM/DD
          return `${new Date().getFullYear()}/${m[1].padStart(2,'0')}/${m[2].padStart(2,'0')}`;
        } else if (m.length >= 3 && re === patterns[2]) {
          // MM월 DD일
          return `${new Date().getFullYear()}/${m[1].padStart(2,'0')}/${m[2].padStart(2,'0')}`;
        } else if (m.length >= 2 && (re === patterns[3] || re === patterns[4])) {
          // DD일, DD일까지
          return `${new Date().getFullYear()}/${(new Date().getMonth()+1).toString().padStart(2,'0')}/${m[1].padStart(2,'0')}`;
        }
      }
    }
    // YYYY년 MM월 DD일 패턴 우선 적용
    const yearMonthDay = body.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
    if (yearMonthDay) {
      return `${yearMonthDay[1]}/${yearMonthDay[2].padStart(2,'0')}/${yearMonthDay[3].padStart(2,'0')}`;
    }
    return null;
  };



  ipcMain.on('open-settings', () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.focus();
      return;
    }
      settingsWindow = new BrowserWindow({
        width: 800,
        height: 480,
        resizable: false,
        alwaysOnTop: true,
        frame: false, // 프레임리스
        transparent: true, // 투명 배경
        icon: winIcon,
        webPreferences: {
          preload: path.join(__dirname, 'preload.js'),
          contextIsolation: true,
          nodeIntegration: false
        }
      });
    settingsWindow.loadFile('settings.html');
    settingsWindow.on('closed', () => { settingsWindow = null; });
  });
}


app.whenReady().then(() => {
    // 트레이 아이콘 생성
    tray = new Tray(iconPath);
    tray.setToolTip('할일 위젯');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '열기', click: () => {
          if (!mainWindow || mainWindow.isDestroyed()) {
            createWindow();
          } else {
            mainWindow.show();
          }
        }
      },
      { label: '종료', click: () => { app.quit(); } }
    ]));

    // 1분마다 emails 테이블에서 todo_flag가 NULL인 메일을 분석하여 todo_flag 업데이트
    const analyzeTodos = async () => {
      // const db = require('./db');
      const ort = require('onnxruntime-node');
      let session = null;
      async function loadModel() {
        if (!session) session = await ort.InferenceSession.create('todo_classifier.onnx');
      }
      // 마감일 패턴(몇일까지 제출 등)
      const deadlinePatterns = [
        /(\d{1,2})월\s?(\d{1,2})일.*제출/, /(\d{1,2})일까지.*제출/, /(\d{1,2})일.*제출/, /by\s+(\d{1,2})[./-](\d{1,2})/i, /submit.*by.*(\d{1,2})[./-](\d{1,2})/i
      ];
      const adKeywords = ['instagram', 'facebook', '온라인투어', 'onlinetour', '페이스북', '인스타그램'];
      const emails = db.prepare('SELECT * FROM emails WHERE todo_flag IS NULL').all();
      for (const mail of emails) {
        const text = ((mail.subject || '') + ' ' + (mail.body || '')).toLowerCase();
        const from = (mail.from_addr || '').toLowerCase();
        // 광고성 메일 제외
        const isAdMail = adKeywords.some(kw => from.includes(kw) || text.includes(kw));
        let todoFlag = 0;
        if (!isAdMail) {
          const hasDeadline = deadlinePatterns.some(re => text.match(re));
          if (hasDeadline) {
            try {
              await loadModel();
              const inputTensor = new ort.Tensor('string', [text], [1]);
              const feeds = { input: inputTensor };
              const results = await session.run(feeds);
              const score = results.output.data[0];
              todoFlag = score > 0.8 ? 1 : 0;
            } catch (err) {
              todoFlag = 1;
            }
          }
        }
        db.prepare('UPDATE emails SET todo_flag = ? WHERE id = ?').run(todoFlag, mail.id);
        // todo_flag=1이면 todos에 insert (중복 방지)
        if (todoFlag === 1) {
          const crypto = require('crypto');
          const hash = crypto.createHash('sha256').update((mail.subject||'')+(mail.body||'')+(mail.from_addr||'')+(mail.deadline||'')).digest('hex');
          const exists = db.prepare('SELECT COUNT(*) as cnt FROM todos WHERE unique_hash = ?').get(hash);
          if (exists.cnt === 0) {
            db.prepare('INSERT INTO todos (task, memo, deadline, unique_hash) VALUES (?, ?, ?, ?)').run(mail.subject, '', mail.deadline, hash);
          }
        }
      }
    };
    setInterval(analyzeTodos, 60 * 1000);
    analyzeTodos();
  createWindow();
  setupMailIpc();

  // 1분마다 환경설정의 메일 계정으로 메일 동기화
  // const db = require('./db');
  // const { BrowserWindow } = require('electron');
  let syncMailInterval = null;
  const syncMail = async () => {
    const row = db.prepare('SELECT * FROM mail_settings ORDER BY id DESC LIMIT 1').get();
    if (row && row.mail_id && row.mail_pw && row.protocol && row.mail_type) {
      const mailModule = require('./mail');
      if (typeof mailModule.syncMail === 'function') {
        await mailModule.syncMail({ ...row, mail_server: row.mail_server });
      } else {
        const win = BrowserWindow.getAllWindows()[0];
        if (win) {
          win.webContents.send('mail-connect', { ...row, mail_server: row.mail_server });
        }
      }
    }
  };
  function startMailSync() {
    if (syncMailInterval) clearInterval(syncMailInterval);
    syncMailInterval = setInterval(syncMail, 60 * 1000);
    syncMail(); // 앱 시작 직후 1회 실행
  }
  function stopMailSync() {
    if (syncMailInterval) {
      clearInterval(syncMailInterval);
      syncMailInterval = null;
    }
  }
  // 앱 시작 시 자동 연동
  startMailSync();

  // IPC로 연동 시작/중지 제어
  ipcMain.handle('start-mail-sync', () => {
    startMailSync();
    return { success: true };
  });
  ipcMain.handle('stop-mail-sync', () => {
    stopMailSync();
    return { success: true };
  });
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  // 모든 창이 닫혀도 앱을 종료하지 않음 (트레이 아이콘 유지)
});
