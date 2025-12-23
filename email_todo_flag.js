const db = require('./db');
const crypto = require('crypto');

const TODO_KEYWORDS = [
  '할일', '제출', '제출기한', '마감', '기한', '검토', '확인', '필수', '요청', '요구', '청구', '협조', '회신', '답장', '작성', '기재',
  '과제', '숙제', 'deadline', 'due', 'todo', 'assignment', 'report', '언제까지'
];

function markTodoEmails() {
  let userKeywords = [];
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('todo_keywords');
    if (row && row.value) {
      userKeywords = row.value.split(',').map(s => s.trim()).filter(Boolean);
    }
  } catch (e) {}
  
  const keywords = userKeywords.length > 0 ? userKeywords : TODO_KEYWORDS;
  const emailsToMark = db.prepare('SELECT id, subject, body FROM emails WHERE todo_flag = 0').all();
  const update = db.prepare('UPDATE emails SET todo_flag = 1 WHERE id = ?');
    const updateExclude = db.prepare('UPDATE emails SET todo_flag = 9 WHERE id = ?');
    let excludeKeywords = db.prepare("SELECT word FROM keywords WHERE type = 'exclude'").all().map(r => r.word);
    // excludeKeywords가 "회의,광고" 같은 문자열로 들어올 경우 배열로 변환
    if (excludeKeywords.length === 1 && typeof excludeKeywords[0] === 'string' && excludeKeywords[0].includes(',')) {
      excludeKeywords = excludeKeywords[0].split(',').map(k => k.trim()).filter(Boolean);
    }
    // 제외된 이메일 제목 목록 가져오기
    const excludedSubjects = db.prepare('SELECT subject FROM emails WHERE todo_flag = 9').all().map(r => r.subject).filter(Boolean);
  
  for (const mail of emailsToMark) {
    const subjectText = (mail.subject || '').toLowerCase();
    // 1. 제외 키워드가 포함된 경우
    if (excludeKeywords.some(k => k && subjectText.includes(k.toLowerCase()))) {
      updateExclude.run(mail.id);
      continue;
    }
    // 2. 제외된 이메일 제목과 유사한 경우(유사도 0.8 이상)
    if (excludedSubjects.some(exSubj => similarity(subjectText, (exSubj || '').toLowerCase()) >= 0.8)) {
      updateExclude.run(mail.id);
      continue;
    }
    const actionKeywords = ['요청', '요구', '청구', '협조', '제출', '회신', '답장', '작성', '기재'];
    const hasAction = actionKeywords.some(k => subjectText.includes(k));
    const hasTodoKeyword = keywords.some(k => k && subjectText.includes(k.toLowerCase()));
    if (hasAction || hasTodoKeyword) {
      update.run(mail.id);
    }
  }
}

function addTodosFromEmailTodos() {
  try {
    const deletedMails = db.prepare('SELECT subject FROM delemail').all();
    let excludeKeywords = db.prepare("SELECT word FROM keywords WHERE type = 'exclude'").all().map(r => r.word);
    if (excludeKeywords.length === 1 && typeof excludeKeywords[0] === 'string' && excludeKeywords[0].includes(',')) {
      excludeKeywords = excludeKeywords[0].split(',').map(k => k.trim()).filter(Boolean);
    }
    
    // 1. 변환 대기 중인(todo_flag = 1) 메일만 가져옴
    const targetEmails = db.prepare('SELECT id, subject, body, deadline, received_at FROM emails WHERE todo_flag = 1').all();
    // todo_flag=9(제외)된 이메일 제목 목록
    const excludedSubjects = db.prepare('SELECT subject FROM emails WHERE todo_flag = 9').all().map(r => r.subject).filter(Boolean);
    
    const insertTodo = db.prepare(`
      INSERT OR IGNORE INTO todos (date, dday, task, memo, deadline, todo_flag, email_hash) 
      VALUES (?, ?, ?, ?, ?, 1, ?)
    `);
    
    // 2. 변환 완료 후 메일 플래그를 2로 바꿔서 다시는 안 불러오게 함
    const updateEmailFlag = db.prepare('UPDATE emails SET todo_flag = 2 WHERE id = ?');
    const checkExists = db.prepare('SELECT id FROM todos WHERE email_hash = ?');
    
    const today = new Date().toISOString().slice(0, 10);

    for (const mail of targetEmails) {

      // 1. delemail로 이동된(제외된) 제목은 다시 todos로 분류하지 않음
      if (deletedMails.some(dm => dm.subject && mail.subject && normalize(dm.subject) === normalize(mail.subject))) {
        updateEmailFlag.run(mail.id);
        continue;
      }
      // 2. todo_flag=9(제외)된 제목과 유사한 경우도 제외
      if (excludedSubjects.some(exSubj => similarity((mail.subject || '').toLowerCase(), (exSubj || '').toLowerCase()) >= 0.8)) {
        updateEmailFlag.run(mail.id);
        continue;
      }

      // 고유 해시 생성
      const rawContent = (mail.received_at || '') + (mail.subject || '').trim();
      const uniqueId = crypto.createHash('sha256').update(rawContent).digest('hex');

      // 중복 체크
      if (checkExists.get(uniqueId)) {
        updateEmailFlag.run(mail.id);
        continue;
      }

      let finalDeadline = extractDeadlineDate(mail.subject) || extractDeadlineDate(mail.body) || mail.deadline || '';

      const result = insertTodo.run(
        today,
        '',
        mail.subject,
        (mail.body || '').substring(0, 500),
        finalDeadline,
        uniqueId
      );

      // 삽입 후 메일 상태를 '완료(2)'로 변경
      updateEmailFlag.run(mail.id);
      
      if (result.changes > 0) {
        console.log(`[Success] 새 할일 추가: ${mail.subject}`);
      }
    }
  } catch (error) {
    console.error('[addTodos] 실행 중 에러:', error);
  }
}

// --- 보조 함수 (동일) ---
function extractDeadlineDate(str) {
  if (!str) return null;
  const thisYear = new Date().getFullYear();
    // 괄호 안 (M/D), (M.D), (M-D) 패턴 우선 추출
    const parenDateMatch = str.match(/\((\d{1,2})[\/\.\-](\d{1,2})\)/);
    if (parenDateMatch) {
      const month = parseInt(parenDateMatch[1], 10);
      const day = parseInt(parenDateMatch[2], 10);
      let year = new Date().getFullYear();
      const candidate = new Date(year, month - 1, day);
      if (candidate < new Date().setHours(0, 0, 0, 0)) year += 1;
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    // 문장 중간, 한글과 붙은 날짜도 인식 (예: 12/1까지, 12.1까지, 12-1까지)
    const monthDayMatch = str.match(/(?:^|\D)(\d{1,2})[\/\.\-](\d{1,2})(?=\D|$)/);
    if (monthDayMatch) {
      const month = parseInt(monthDayMatch[1], 10);
      const day = parseInt(monthDayMatch[2], 10);
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return `${thisYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    }
  return null;
}

function normalize(str) {
  // 1. 소문자 변환
  let s = (str || '').toLowerCase();
  // 2. 괄호 및 괄호 안 내용 제거
  s = s.replace(/\([^)]*\)/g, '');
  // 3. 날짜(YYYY, MM, DD, 1~31), 요일(한글/영문), 숫자 제거
  s = s.replace(/\d{4}년|\d{4}|\d{1,2}월|\d{1,2}일|\d{1,2}시|\d{1,2}분|\d{1,2}초/g, '');
  s = s.replace(/\d{1,2}/g, '');
  s = s.replace(/(월|화|수|목|금|토|일|mon|tue|wed|thu|fri|sat|sun)/g, '');
  // 4. 특수문자, 공백 제거
  s = s.replace(/[^\w가-힣]/g, '');
  s = s.replace(/\s+/g, '');
  return s;
}

function similarity(a, b) {
  a = normalize(a); b = normalize(b);
  if (!a || !b) return 0;
  const m = a.length, n = b.length;
  const dp = Array.from({length: m+1}, () => Array(n+1).fill(0));
  for (let i=0; i<=m; i++) dp[i][0] = i;
  for (let j=1; j<=m; j++) {
    for (let k=1; k<=n; k++) {
      if (a[j-1] === b[k-1]) dp[j][k] = dp[j-1][k-1];
      else dp[j][k] = 1 + Math.min(dp[j-1][k], dp[j][k-1], dp[j-1][k-1]);
    }
  }
  return 1 - dp[m][n] / Math.max(m, n);
}

module.exports = markTodoEmails;
module.exports.addTodosFromEmailTodos = addTodosFromEmailTodos;