// 이메일 제목/본문에서 to-do(할일, 제출, 검토, 기한 등) 키워드가 있으면 todo_flag=1로 업데이트
// (간단한 키워드 기반, 추후 onnxruntime-node 연동 가능)

const db = require('./db');

const TODO_KEYWORDS = [
  '할일', '제출', '제출기한', '마감', '기한', '검토', '확인', '필수', '요청', '과제', '숙제', 'deadline', 'due', 'todo', 'assignment', 'report',
  '회신', '언제까지'
];
// 날짜 표현(몇월 몇일까지, yyyy년 mm월 dd일까지 등) 정규식
const DEADLINE_PATTERNS = [
  /\d{1,2}월 ?\d{1,2}일(\s*)?까지/, // 예: 12월 25일까지
  /\d{4}년 ?\d{1,2}월 ?\d{1,2}일(\s*)?까지/, // 예: 2025년 1월 3일까지
  /\d{1,2}일(\s*)?까지/, // 예: 25일까지
];

// 요청/요구 표현 정규식 (예: ~해 주세요, ~해 주시기 바랍니다, ~부탁드립니다 등)
const REQUEST_PATTERNS = [
  /해 ?주[세십]?[요니다]/,
  /부탁(드립니다|해요|합니다)/,
  /요청(드립니다|합니다|해요)/,
  /주시기 바랍니다/,
  /필요합니다/,
  /제출 바랍니다/,
  /회신 바랍니다/
];

function markTodoEmails() {
  // settings 테이블에서 todo_keywords 값(쉼표 구분) 불러오기
  let userKeywords = [];
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('todo_keywords');
    if (row && row.value) {
      userKeywords = row.value.split(',').map(s => s.trim()).filter(Boolean);
    }
  } catch (e) {}
  const keywords = userKeywords.length > 0 ? userKeywords : TODO_KEYWORDS;
  const emails = db.prepare('SELECT id, subject, body FROM emails WHERE todo_flag = 0').all();
  const update = db.prepare('UPDATE emails SET todo_flag = 1 WHERE id = ?');
  for (const mail of emails) {
    const text = (mail.subject + ' ' + (mail.body || '')).toLowerCase();
    // 키워드가 본문에 하나라도 있으면 todo로 분류
    const hasTodoKeyword = keywords.some(k => k && text.includes(k.toLowerCase()));
    if (hasTodoKeyword) {
      update.run(mail.id);
    }
  }
}

if (require.main === module) {
  markTodoEmails();
  console.log('이메일 todo_flag 업데이트 완료');
}

module.exports = markTodoEmails;

// emails 테이블에서 todo_flag=1인 이메일을 todos 테이블에 할일로 추가

function addTodosFromEmailTodos() {
  // 1. email.todo_flag=0인 메일 기반 todos를 삭제
  const emailsToRemove = db.prepare('SELECT subject FROM emails WHERE todo_flag = 0').all();
  const deleteTodo = db.prepare('DELETE FROM todos WHERE task = ? AND todo_flag = 1');
  for (const mail of emailsToRemove) {
    deleteTodo.run(mail.subject);
  }

  // 2. email.todo_flag=1인 메일을 todos에 추가 (중복 방지)
  const emails = db.prepare('SELECT id, subject, body, deadline FROM emails WHERE todo_flag = 1').all();
  const insertTodo = db.prepare('INSERT INTO todos (date, dday, task, memo, deadline, todo_flag) VALUES (?, ?, ?, ?, ?, 1)');
  const now = new Date();
  const today = now.toISOString().slice(0, 10); // YYYY-MM-DD
  for (const mail of emails) {
    const exists = db.prepare('SELECT COUNT(*) as cnt FROM todos WHERE task = ? AND todo_flag = 1').get(mail.subject).cnt;
    if (exists === 0) {
      insertTodo.run(
        today, // date
        '',    // dday
        mail.subject, // task
        mail.body || '', // memo
        mail.deadline || '' // deadline
      );
    }
  }
}

module.exports.addTodosFromEmailTodos = addTodosFromEmailTodos;
