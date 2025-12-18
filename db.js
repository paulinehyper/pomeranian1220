
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


db.exec(`
CREATE TABLE IF NOT EXISTS todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  dday TEXT NOT NULL,
  task TEXT NOT NULL,
  memo TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS autoplay (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER DEFAULT 0
);
INSERT OR IGNORE INTO autoplay (id, enabled) VALUES (1, 0);

CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT,
  from_addr TEXT NOT NULL,
  todo_flag INTEGER DEFAULT 0,
  unique_hash TEXT,
  deadline TEXT,
  memo TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS mail_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mail_type TEXT,
  protocol TEXT,
  mail_id TEXT,
  mail_pw TEXT,
  mail_since TEXT,
  mail_server TEXT,
  host TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS keyword (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

`);

// Keyword 전체 조회 함수
db.getAllKeywords = function() {
  return db.prepare('SELECT keyword FROM keyword ORDER BY id DESC').all().map(row => row.keyword);
};
// Keyword 수정 함수
db.updateKeyword = function(oldKw, newKw) {
  return db.prepare('UPDATE keyword SET keyword = ? WHERE keyword = ?').run(newKw, oldKw);
};
// Keyword 삭제 함수
db.deleteKeyword = function(kw) {
  return db.prepare('DELETE FROM keyword WHERE keyword = ?').run(kw);
};

// todos 테이블에 할일을 저장하는 함수 (deadline 컬럼 포함)
// 사용 예: db.insertTodo({ date: '2025-12-13', dday: 'D-1', task: '할일', memo: '메모', deadline: '2025-12-13' })
db.insertTodo = function({ date, dday, task, memo, deadline }) {
  return db.prepare('INSERT INTO todos (date, dday, task, memo, deadline) VALUES (?, ?, ?, ?, ?)').run(date, dday, task, memo || '', deadline || '');
};



// Migration: add deadline column to todos if missing
const todosPragma = db.prepare("PRAGMA table_info(todos)").all();
const todosHasDeadline = todosPragma.some(col => col.name === 'deadline');
if (!todosHasDeadline) {
  db.exec('ALTER TABLE todos ADD COLUMN deadline TEXT');
}
// Migration: add todo_flag column to todos if missing
const todosHasTodoFlag = todosPragma.some(col => col.name === 'todo_flag');
if (!todosHasTodoFlag) {
  db.exec('ALTER TABLE todos ADD COLUMN todo_flag INTEGER DEFAULT 1');
}

// Migration: add deadline column to emails if missing
const emailsPragma = db.prepare("PRAGMA table_info(emails)").all();
const emailsHasDeadline = emailsPragma.some(col => col.name === 'deadline');
if (!emailsHasDeadline) {
  db.exec('ALTER TABLE emails ADD COLUMN deadline TEXT');
}

// Migration: add unique_hash column to emails if missing
const emailsHasUniqueHash = emailsPragma.some(col => col.name === 'unique_hash');
if (!emailsHasUniqueHash) {
  db.exec('ALTER TABLE emails ADD COLUMN unique_hash TEXT');
}

// Migration: add host column to mail_settings if missing
const mailSettingsPragma = db.prepare("PRAGMA table_info(mail_settings)").all();
const mailSettingsHasHost = mailSettingsPragma.some(col => col.name === 'host');
if (!mailSettingsHasHost) {
  db.exec('ALTER TABLE mail_settings ADD COLUMN host TEXT');
}

module.exports = db;
