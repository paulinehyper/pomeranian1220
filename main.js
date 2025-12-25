// mail.js에서 사용할 수 있도록 export
module.exports.autoClassifyEmailTodo = autoClassifyEmailTodo;

const { app, BrowserWindow, ipcMain, Tray, Menu, dialog } = require('electron');
const path = require('path');
const db = require('./db');

const setupMailIpc = require('./mail'); // mail.js 모듈 로드

// 이메일 자동 할일 분류: 마감일 패턴이 있으면 todo_flag=1로 설정
function autoClassifyEmailTodo(subject, body) {
  // exclude 키워드 체크
  let excludeKeywords = db.prepare("SELECT word FROM keywords WHERE type = 'exclude'").all().map(r => r.word);
  if (excludeKeywords.length === 1 && typeof excludeKeywords[0] === 'string' && excludeKeywords[0].includes(',')) {
    excludeKeywords = excludeKeywords[0].split(',').map(k => k.trim()).filter(Boolean);
  }
  const subjectText = (subject || '').toLowerCase();
  const bodyText = (body || '').toLowerCase();
  for (const k of excludeKeywords) {
    if (!k) continue;
    const kw = k.toLowerCase();
    if (subjectText.includes(kw) || bodyText.includes(kw)) {
      return 9; // 무조건 제외
    }
  }

  // include 키워드 체크 (DB에서 type='include'인 키워드 불러오기)
  let includeKeywords = db.prepare("SELECT word FROM keywords WHERE type = 'include'").all().map(r => r.word);
  if (includeKeywords.length === 1 && typeof includeKeywords[0] === 'string' && includeKeywords[0].includes(',')) {
    includeKeywords = includeKeywords[0].split(',').map(k => k.trim()).filter(Boolean);
  }
  for (const k of includeKeywords) {
    if (!k) continue;
    const kw = k.toLowerCase();
    if (subjectText.includes(kw) || bodyText.includes(kw)) {
      return 1; // 할일로 분류
    }
  }

  // '12/29까지', '12.29까지', '12-29까지' 등 패턴
  const deadlinePattern = /(\d{1,2})[\/.\-](\d{1,2})\s*까지/;
  if (deadlinePattern.test(subject) || deadlinePattern.test(body)) {
    return 1; // 할일로 분류
  }
  return 0;
}

// [자동분류] 이메일 신규 저장 시 마감일 패턴이 있으면 todo_flag=1로 자동 분류
ipcMain.handle('insert-email', (event, email) => {
  // email: { subject, body, ... }
  const todoFlag = autoClassifyEmailTodo(email.subject, email.body);
  db.prepare('INSERT INTO emails (subject, body, todo_flag, received_at, from_addr) VALUES (?, ?, ?, ?, ?)')
    .run(email.subject, email.body, todoFlag, email.received_at || '', email.from_addr || '');
  return { success: true, todo_flag: todoFlag };
});


// 이메일 할일 마감일 저장 IPC
ipcMain.handle('set-email-deadline', (event, id, deadline) => {
  // emails 테이블의 deadline 필드 업데이트
  db.prepare('UPDATE emails SET deadline = ? WHERE id = ?').run(deadline, id);
  return true;
});
/**
 * [추가] 텍스트에서 날짜(MM/DD, MM.DD)를 추출하여 YYYY-MM-DD 형식으로 변환
 */
/**
 * [수정] 날짜 추출 함수: 더 다양한 패턴 인식 및 정확한 연도 계산
 */
function extractDeadlineDate(text) {
  if (!text) return null;

  // 정규식 보강: 숫자/숫자 또는 숫자.숫자 (예: 12/30, 1.15, 05/02 등)
  // \b를 사용하여 다른 숫자와 섞이지 않도록 함
  const dateRegex = /\b(\d{1,2})[\/.](\d{1,2})\b/;
  const match = text.match(dateRegex);

  if (match) {
    let month = parseInt(match[1]);
    let day = parseInt(match[2]);

    // 월/일 유효성 체크 (예: 13월 40일 방지)
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;

    const now = new Date();
    const currentYear = now.getFullYear();
    
    // 올해 기준으로 날짜 설정
    let targetDate = new Date(currentYear, month - 1, day);

    // [로직] 오늘보다 이미 지난 날짜라면 (예: 오늘 12/22인데 메일에 1/15가 있으면) 내년으로 설정
    // 00:00:00 기준으로 비교하기 위해 시간을 초기화합니다.
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (targetDate < today) {
      targetDate.setFullYear(currentYear + 1);
    }

    const yyyy = targetDate.getFullYear();
    const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
    const dd = String(targetDate.getDate()).padStart(2, '0');

    console.log(`[날짜 인식 성공] 추출된 텍스트: ${match[0]} -> 변환: ${yyyy}-${mm}-${dd}`);
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
}

/**
 * 전역 변수 및 설정
 */
let mainWindow = null;
let tray = null;

const iconPath = process.platform === 'darwin'
  ? path.join(__dirname, 'assets', 'icon.png')
  : path.join(__dirname, 'icon.ico');

/**
 * 1. 초기화 및 테이블 생성
 */
try {
  // delemail 테이블 생성
  db.prepare(`CREATE TABLE IF NOT EXISTS delemail (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    received_at TEXT, subject TEXT, body TEXT, from_addr TEXT,
    todo_flag INTEGER, unique_hash TEXT, deadline TEXT, created_at TEXT
  )`).run();

  // keywords 테이블 type 컬럼 추가 체크
  const pragma = db.prepare('PRAGMA table_info(keywords)').all();
  if (!pragma.some(col => col.name === 'type')) {
    db.exec('ALTER TABLE keywords ADD COLUMN type TEXT');
  }

  // todos 테이블에 sort_order 컬럼 추가
  const todoColumns = db.prepare('PRAGMA table_info(todos)').all();
  if (!todoColumns.some(col => col.name === 'sort_order')) {
    db.exec('ALTER TABLE todos ADD COLUMN sort_order INTEGER DEFAULT 0');
  }
} catch (e) { console.error("DB Init Error:", e); }

/**
 * 2. IPC 핸들러 등록 (모든 기능 포함)
 */

// [신규/수정] 이메일 할일 목록 반환 (에러 발생했던 부분)
// main.js 내 해당 부분
ipcMain.handle('get-todo-emails', () => {
  try {
    // todo_flag IN (1,2) (미완료/완료 이메일 할일 모두)
    return db.prepare('SELECT id, subject, body, received_at, deadline, from_addr, todo_flag FROM emails WHERE todo_flag IN (1,2) ORDER BY todo_flag ASC, received_at DESC').all();
  } catch (err) { return []; }
});

// 이메일 상태(완료/휴지통) 변경 핸들러
ipcMain.handle('set-mail-complete', (event, id, flag) => {
  try {
    db.prepare('UPDATE emails SET todo_flag = ? WHERE id = ?').run(flag, id);
    return { success: true };
  } catch (err) {
    return { success: false };
  }
});


// 할일 목록 가져오기
ipcMain.handle('get-todos', (event, mode) => {
  try {
    let todos = (mode === 'trash') 
      ? db.prepare('SELECT * FROM todos WHERE todo_flag = 3 ORDER BY id DESC').all()
      : db.prepare('SELECT * FROM todos WHERE todo_flag IN (1, 2) ORDER BY sort_order ASC, id DESC').all();
    return todos.map(t => ({
      id: t.id,
      task: t.task || t.content || '제목 없음',
      memo: t.memo || '',
      deadline: t.deadline || '없음',
      date: t.date,
      dday: t.dday,
      todo_flag: t.todo_flag
    }));
  } catch (err) { return []; }
});

// Drag & Drop 순서 저장용 IPC 핸들러
ipcMain.handle('update-todo-order', (event, orderArray) => {
  // orderArray 예시: [{id: 5, order: 0}, {id: 2, order: 1}, ...]
  const updateStmt = db.prepare('UPDATE todos SET sort_order = ? WHERE id = ?');
  const transaction = db.transaction((items) => {
    for (const item of items) {
      updateStmt.run(item.order, item.id);
    }
  });
  transaction(orderArray);
  return { success: true };
});

// 할일 추가
ipcMain.handle('insert-todo', (event, { task, deadline, memo }) => {
  try {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 19).replace('T', ' ');
    let ddayValue = 0;
    if (deadline) {
      const target = new Date(deadline);
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      ddayValue = Math.ceil((target - today) / (1000 * 60 * 60 * 24));
    }
    // '광고' 키워드가 task 또는 memo에 포함되면 todo_flag=0(제외)로 등록
    const isAd = (task && task.includes('광고')) || (memo && memo.includes('광고'));
    db.prepare(`INSERT INTO todos (date, task, memo, deadline, dday, todo_flag) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(dateStr, task, memo || '', deadline || '', ddayValue, isAd ? 0 : 1);

    // 트레이 팝업 알림 (할일카드 추가 시, 광고 제외는 알림X)
    if (!isAd && tray && global.showTrayPopup) {
      global.showTrayPopup({ subject: `[할일 추가] ${task}` });
    }

    notifyRefresh(); // 실시간 갱신 신호
    return { success: true };
  } catch (err) { return { success: false, error: err.message }; }
});

// 마감일 수정
ipcMain.handle('set-todo-deadline', (event, id, deadline) => {
  try {
    let ddayValue = 0;
    if (deadline) {
      const now = new Date();
      const target = new Date(deadline);
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      ddayValue = Math.ceil((target - today) / (1000 * 60 * 60 * 24));
    }
    db.prepare('UPDATE todos SET deadline = ?, dday = ? WHERE id = ?').run(deadline, ddayValue, id);
    notifyRefresh();
    return { success: true };
  } catch (err) { return { success: false, error: err.message }; }
});

// 완료/복구 토글
ipcMain.handle('set-todo-complete', (event, id, flag) => {
  db.prepare('UPDATE todos SET todo_flag = ? WHERE id = ?').run(flag, id);
  notifyRefresh();
  return { success: true };
});

// [main.js] exclude-todo 핸들러 수정
// [main.js] 이 부분을 찾아 교체하세요
ipcMain.handle('exclude-todo', (event, id, isEmail) => { // id와 isEmail 두 개를 받아야 합니다.
  try {
    let titleToExclude = "";
    
    if (isEmail) {
      const email = db.prepare('SELECT subject FROM emails WHERE id = ?').get(id);
      if (email) {
        titleToExclude = email.subject;
        db.prepare('UPDATE emails SET todo_flag = 0 WHERE id = ?').run(id);
      }
    } else {
      const todo = db.prepare('SELECT task FROM todos WHERE id = ?').get(id);
      if (todo) {
        titleToExclude = todo.task;
        db.prepare('UPDATE todos SET todo_flag = 0 WHERE id = ?').run(id);
      }
    }

    if (titleToExclude) {
      db.prepare('INSERT OR IGNORE INTO keywords (word, type) VALUES (?, ?)')
        .run(titleToExclude, 'exclude');
    }

    notifyRefresh();
    return { success: true };
  } catch (err) {
    console.error("Exclude Error:", err);
    return { success: false };
  }
});

// 키워드 관리
const { markTodoEmails } = require('./email_todo_flag');
ipcMain.handle('get-keywords', () => db.prepare("SELECT id, word, type FROM keywords").all());
ipcMain.handle('insert-keyword', (event, keyword) => {
  try {
    let word, type;
    if (typeof keyword === 'object' && keyword !== null) {
      word = keyword.word;
      type = keyword.type || 'include';
    } else {
      word = keyword;
      type = 'include';
    }
    db.prepare('INSERT INTO keywords (word, type) VALUES (?, ?)').run(word, type);
    db.prepare('UPDATE emails SET todo_flag = 1 WHERE subject LIKE ?').run(`%${word}%`);
    // exclude 키워드 등록 시 바로 메일 분류 적용
    if (type === 'exclude') {
      markTodoEmails();
    }
    notifyRefresh();
    return { success: true };
  } catch (err) { return { success: false }; }
});
ipcMain.handle('delete-keyword', (event, id) => {
  db.prepare('DELETE FROM keywords WHERE id = ?').run(id);
  return { success: true };
});

// 메모 저장
ipcMain.handle('save-memo', (event, id, memo) => {
  db.prepare('UPDATE todos SET memo = ? WHERE id = ?').run(memo, id);
  return { success: true };
});

// 설정 및 기타
ipcMain.handle('get-mail-settings', () => {
  try {
    const row = db.prepare('SELECT * FROM mail_settings WHERE id=1').get();
    return row ? { protocol: row.protocol, mailId: row.mail_id, mailPw: row.mail_pw, host: row.host, port: row.port, mailSince: row.mail_since } : {};
  } catch (err) { return {}; }
});

ipcMain.handle('save-mail-settings', (event, settings) => {
  try {
    db.prepare(`INSERT INTO mail_settings (id, protocol, mail_id, mail_pw, host, port, mail_since) 
      VALUES (1, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET 
      protocol=excluded.protocol, mail_id=excluded.mail_id, mail_pw=excluded.mail_pw, 
      host=excluded.host, port=excluded.port, mail_since=excluded.mail_since`)
      .run(settings.protocol, settings.mailId, settings.mailPw, settings.host, settings.port, settings.mailSince);
    setTimeout(() => syncMail(), 1000);
    return { success: true };
  } catch (err) { return { success: false }; }
});

ipcMain.handle('delete-all-todos', () => {
  db.prepare('DELETE FROM todos').run();
  notifyRefresh();
  return { success: true };
});

/**
 * 3. 창 제어 및 화면 갱신 유틸리티
 */
function notifyRefresh() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('new-todo-added');
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    title: 'Pomeranian',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  mainWindow.loadFile('main.html');
  mainWindow.on('closed', () => { mainWindow = null; });
}

ipcMain.on('close', () => { if (mainWindow) mainWindow.close(); });
ipcMain.on('minimize', () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.on('open-app-settings', () => { /* 설정창 열기 로직 */ });
ipcMain.on('open-emails', () => {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    autoHideMenuBar: true,
    title: 'Pomeranian',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  win.loadFile('mail-list.html');
});
ipcMain.on('open-mail-detail', (event, params) => {
  const win = new BrowserWindow({
    width: 700,
    height: 600,
    frame: false,
    alwaysOnTop: true,
    title: 'Pomeranian',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  win.loadURL(`file://${__dirname}/mail-detail.html?${params}`);
});

/**
 * 4. 메일 동기화 및 알림
 */
async function syncMail() {
  try {
    const row = db.prepare('SELECT * FROM mail_settings WHERE id=1').get();
    if (row && row.mail_id && row.mail_pw) {
      const mailModule = require('./mail');
      // 메일 서버와 동기화 실행
      await mailModule.syncMail(row);

      // deadline이 아직 없는 메일들만 골라서 다시 한번 날짜 분석을 수행합니다.
      const pendingEmails = db.prepare("SELECT * FROM emails WHERE (deadline IS NULL OR deadline = '' OR deadline = '없음') AND todo_flag IN (1,2)").all();

      if (pendingEmails.length > 0) {
        const updateStmt = db.prepare('UPDATE emails SET deadline = ? WHERE id = ?');
        // 데이터베이스 트랜잭션으로 처리하여 성능 향상
        const updateTransaction = db.transaction((emails) => {
          for (const email of emails) {
            const detected = extractDeadlineDate(email.subject) || extractDeadlineDate(email.body);
            if (detected) {
              updateStmt.run(detected, email.id);
            }
          }
        });
        updateTransaction(pendingEmails);
        console.log(`[분석 완료] ${pendingEmails.length}개의 메일 날짜 재검토 완료`);
      }

      notifyRefresh(); // UI 갱신 신호 발송
      // [수정] 알림을 보내지 않은 메일만 선택
      const freshEmails = db.prepare("SELECT * FROM emails WHERE is_notified = 0 AND todo_flag IN (1,2)").all();
      if (freshEmails.length > 0 && tray) {
        const updateStmt = db.prepare('UPDATE emails SET is_notified = 1 WHERE id = ?');
        freshEmails.forEach((m, i) => {
          setTimeout(() => {
            global.showTrayPopup(m);
            updateStmt.run(m.id);
          }, i * 3000);
        });
      }
    }
  } catch (err) { 
    console.error("Sync Error:", err); 
  }
}

/**
 * 5. 앱 실행 (Life-cycle)
 */
app.whenReady().then(() => {
  createWindow(); // 창 생성
  setupMailIpc(mainWindow); // 메일 핸들러 연결

  // 트레이 설정
  tray = new Tray(iconPath);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '열기', click: () => { if (mainWindow) mainWindow.show(); else createWindow(); }},
    { label: '종료', role: 'quit' }
  ]));

  // 토스트 팝업 함수
  global.showTrayPopup = function(email) {
    // todo_flag: 1(미완료), 2(완료) => 이메일 할일로 분류된 메일
    const isEmailTodo = email.todo_flag === 1 || email.todo_flag === 2;
    const bgColor = isEmailTodo ? 'linear-gradient(90deg,#fff700 0%,#ffe98a 100%)' : 'rgba(0,180,154,0.95)';
    const title = isEmailTodo ? '이메일 할일' : '새 메일';
    const subject = isEmailTodo ? `[이메일 할일] ${email.subject}` : email.subject;
    const popup = new BrowserWindow({
      width: 320,
      height: 90,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      transparent: true,
      show: false,
      title: 'Pomeranian',
      icon: path.join(__dirname, 'assets', 'icon.png'),
      webPreferences: { contextIsolation: true, nodeIntegration: false }
    });
    const b = tray.getBounds();
    popup.setPosition(b.x - 120, b.y - 100);
    if (isEmailTodo) {
      // 닫기 버튼 추가, 클릭 시 창 닫힘
      const html = `
        <body style="margin:0;padding:15px;background:${bgColor};color:#222;border-radius:10px;font-family:sans-serif;overflow:hidden;position:relative;">
          <b>${title}</b>
          <button id='closeBtn' style="position:absolute;top:10px;right:10px;background:#fff;border:none;border-radius:50%;width:22px;height:22px;font-size:15px;cursor:pointer;">×</button>
          <div style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${subject}</div>
          <script>
            document.getElementById('closeBtn').onclick = function() { window.close(); };
          </script>
        </body>`;
      popup.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      popup.once('ready-to-show', () => popup.show());
      // 자동 닫힘 없음 (사용자가 닫기 버튼 클릭해야 닫힘)
    } else {
      // 기존 새 메일 알림: 자동 닫힘
      popup.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<body style=\"margin:0;padding:15px;background:${bgColor};color:#222;border-radius:10px;font-family:sans-serif;overflow:hidden;\"><b>${title}</b><br><div style=\"font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;\">${subject}</div></body>`));
      popup.once('ready-to-show', () => popup.show());
      setTimeout(() => { if (!popup.isDestroyed()) popup.close(); }, 3500);
    }
  };

  setInterval(syncMail, 60000);
  syncMail();
});

app.on('window-all-closed', () => { if (process.platform === 'darwin') app.quit(); });