
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// 사용자 APPDATA 경로에 DB 저장
const appName = 'pomeranianelect1212';
const appDataDir = process.env.APPDATA ||
  (process.platform === 'darwin' ? path.join(process.env.HOME, 'Library', 'Application Support')
    : path.join(process.env.HOME || '', '.config'));
const dbDir = path.join(appDataDir, appName);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
const dbPath = path.join(dbDir, 'todo.db');
console.log('DB 경로:', dbPath);

const db = new Database(dbPath);

// emails 테이블에 subject+received_at 해시 컬럼(email_hash) 추가 및 UNIQUE 인덱스 생성 (이미 있으면 패스)
try {
  db.exec(`ALTER TABLE emails ADD COLUMN email_hash TEXT`);
} catch (e) {}
try {
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_emails_email_hash ON emails (email_hash)`);
} catch (e) {
  console.error("emails 인덱스 생성 에러:", e.message);
}
// todos.email_hash에 UNIQUE 인덱스 추가 (이미 있으면 패스)
try {
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_todos_email_hash ON todos (email_hash)`);
} catch (e) {
  console.error("인덱스 생성 에러:", e.message);
}
// emails 테이블에 is_notified 컬럼이 없으면 추가
try {
  const col = db.prepare("PRAGMA table_info(emails)").all();
  if (!col.some(c => c.name === 'is_notified')) {
    db.exec(`ALTER TABLE emails ADD COLUMN is_notified INTEGER DEFAULT 0`);
    console.log('is_notified 컬럼 추가 완료');
  }
} catch (e) {
  console.error('is_notified 컬럼 추가 에러:', e.message);
}

// --- 초기 테이블 생성 및 마이그레이션 ---

// 1. 기본 테이블들을 한 번에 생성합니다.
db.exec(`
  CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT,
    task TEXT,
    memo TEXT,
    deadline TEXT,
    dday INTEGER NOT NULL DEFAULT 0,
    todo_flag INTEGER DEFAULT 1,
    mail_flag TEXT
  );

  CREATE TABLE IF NOT EXISTS delemail (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    received_at TEXT,
    subject TEXT,
    body TEXT,
    memo TEXT,
    from_addr TEXT,
    unique_hash TEXT UNIQUE,
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS autoplay (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS emails (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    received_at TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT,
    from_addr TEXT NOT NULL,
    todo_flag INTEGER DEFAULT 0,
    unique_hash TEXT UNIQUE,
    deadline TEXT,
    memo TEXT DEFAULT '',
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS mail_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    protocol TEXT,
    mail_id TEXT,
    mail_pw TEXT,
    host TEXT,
    port TEXT,
    mail_since TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS keywords (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word TEXT NOT NULL,
    type TEXT DEFAULT 'include',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(word, type)
  );
`);

// 2. 데이터 유지하며 누락된 컬럼 추가 (마이그레이션)
const addColumn = (table, column, type) => {
  const pragma = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!pragma.some(col => col.name === column)) {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      console.log(`[Migration] ${table} 테이블에 ${column} 컬럼 추가 완료`);
    } catch (e) { console.error(e); }
  }
};

addColumn('emails', 'created_at', 'TEXT');
addColumn('mail_settings', 'port', 'TEXT');
addColumn('mail_settings', 'mail_since', 'TEXT');
addColumn('todos', 'deadline', 'TEXT');
addColumn('todos', 'todo_flag', 'INTEGER DEFAULT 1');
addColumn('todos', 'mail_flag', 'TEXT');
addColumn('delemail', 'memo', 'TEXT'); // 이전에 에러 났던 부분
addColumn('delemail', 'deadline', 'TEXT'); // 마감기한 컬럼 추가

// --- 초기 데이터 삽입 ---
db.prepare('INSERT OR IGNORE INTO autoplay (id, enabled) VALUES (1, 0)').run();

// --- 함수 정의 ---

// Keyword 관련
// word: string, type: string (default: 'include')
db.insertKeyword = function(word, type = 'include') {
  return db.prepare('INSERT OR IGNORE INTO keywords (word, type) VALUES (?, ?)').run(word, type);
};
db.getAllKeywords = function(type = null) {
  if (type) {
    return db.prepare('SELECT word FROM keywords WHERE type = ? ORDER BY id DESC').all(type).map(row => row.word);
  }
  return db.prepare('SELECT word FROM keywords ORDER BY id DESC').all().map(row => row.word);
};
db.updateKeyword = function(oldKw, newKw, type = 'include') {
  return db.prepare('UPDATE keywords SET word = ? WHERE word = ? AND type = ?').run(newKw, oldKw, type);
};
db.deleteKeyword = function(kw, type = null) {
  if (type) {
    return db.prepare('DELETE FROM keywords WHERE word = ? AND type = ?').run(kw, type);
  }
  return db.prepare('DELETE FROM keywords WHERE word = ?').run(kw);
};

// Todo 관련
db.insertTodo = function({ date, dday, task, memo, deadline, mail_flag }) {
  return db.prepare('INSERT INTO todos (date, dday, task, memo, deadline, mail_flag) VALUES (?, ?, ?, ?, ?, ?)').run(date, dday, task, memo || '', deadline || '', mail_flag || null);
};

module.exports = db;
