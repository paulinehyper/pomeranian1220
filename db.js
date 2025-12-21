
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

// 기존 keyword 테이블이 있으면 삭제 (마이그레이션)
try {
  db.exec('DROP TABLE IF EXISTS keyword');
} catch (e) {}

// emails 테이블에 created_at 컬럼이 없으면 추가 (마이그레이션)
const emailsPragma = db.prepare("PRAGMA table_info(emails)").all();
const emailsHasCreatedAt = emailsPragma.some(col => col.name === 'created_at');
if (!emailsHasCreatedAt) {
  db.exec('ALTER TABLE emails ADD COLUMN created_at TEXT');
}

// mail_settings 테이블에 port 컬럼이 없으면 추가 (마이그레이션)
const mailSettingsPragma = db.prepare("PRAGMA table_info(mail_settings)").all();
const mailSettingsHasPort = mailSettingsPragma.some(col => col.name === 'port');
if (!mailSettingsHasPort) {
  db.exec('ALTER TABLE mail_settings ADD COLUMN port TEXT');
}
const mailSettingsHasSince = mailSettingsPragma.some(col => col.name === 'mail_since');
if (!mailSettingsHasSince) {
  db.exec('ALTER TABLE mail_settings ADD COLUMN mail_since TEXT');
}


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
  id INTEGER PRIMARY KEY CHECK (id = 1),
  protocol TEXT,
  mail_id TEXT,
  mail_pw TEXT,
  host TEXT,
  port TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS keywords (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

`);


// Keyword 전체 조회 함수
db.insertKeyword = function(word) {
  return db.prepare('INSERT OR IGNORE INTO keywords (word) VALUES (?)').run(word);
};
db.getAllKeywords = function() {
  return db.prepare('SELECT word FROM keywords ORDER BY id DESC').all().map(row => row.word);
};
db.updateKeyword = function(oldKw, newKw) {
  return db.prepare('UPDATE keywords SET word = ? WHERE word = ?').run(newKw, oldKw);
};
db.deleteKeyword = function(kw) {
  return db.prepare('DELETE FROM keywords WHERE word = ?').run(kw);
};

// todos 테이블에 할일을 저장하는 함수 (deadline, mail_flag 컬럼 포함)
// 사용 예: db.insertTodo({ date: '2025-12-13', dday: 'D-1', task: '할일', memo: '메모', deadline: '2025-12-13', mail_flag: 'Y' })
db.insertTodo = function({ date, dday, task, memo, deadline, mail_flag }) {
  return db.prepare('INSERT INTO todos (date, dday, task, memo, deadline, mail_flag) VALUES (?, ?, ?, ?, ?, ?)').run(date, dday, task, memo || '', deadline || '', mail_flag || null);
};

// Migration: add columns to todos if missing (중복 없이 한 번만)
const todosPragma = db.prepare("PRAGMA table_info(todos)").all();
const todosHasDeadline = todosPragma.some(col => col.name === 'deadline');
if (!todosHasDeadline) {
  db.exec('ALTER TABLE todos ADD COLUMN deadline TEXT');
}
const todosHasTodoFlag = todosPragma.some(col => col.name === 'todo_flag');
if (!todosHasTodoFlag) {
  db.exec('ALTER TABLE todos ADD COLUMN todo_flag INTEGER DEFAULT 1');
}
const todosHasMailFlag = todosPragma.some(col => col.name === 'mail_flag');
if (!todosHasMailFlag) {
  db.exec("ALTER TABLE todos ADD COLUMN mail_flag TEXT");
}

module.exports = db;
