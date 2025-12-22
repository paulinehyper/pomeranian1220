// 이메일 제목/본문에서 to-do(할일, 제출, 검토, 기한 등) 키워드가 있으면 todo_flag=1로 업데이트
// (간단한 키워드 기반, 추후 onnxruntime-node 연동 가능)

const db = require('./db');

const TODO_KEYWORDS = [
  '할일', '제출', '제출기한', '마감', '기한', '검토', '확인', '필수', '요청', '요구', '청구', '협조', '회신', '답장', '작성', '기재',
  '과제', '숙제', 'deadline', 'due', 'todo', 'assignment', 'report', '언제까지'
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
    // actionKeywords 또는 keywords 중 하나라도 포함되면 todo로 분류
    const actionKeywords = [
      '요청', '요구', '청구', '협조', '제출', '회신', '답장', '작성', '기재'
    ];
    const hasAction = actionKeywords.some(k => text.includes(k));
    const hasTodoKeyword = keywords.some(k => k && text.includes(k.toLowerCase()));
    if (hasAction || hasTodoKeyword) {
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
  const deletedMails = db.prepare('SELECT subject, body FROM delemail').all();
  const excludeKeywords = db.prepare("SELECT word FROM keywords WHERE type = 'exclude'").all().map(r => r.word);
  const emails = db.prepare('SELECT id, subject, body, deadline, received_at FROM emails WHERE todo_flag = 1').all();
  const checkExists = db.prepare('SELECT todo_flag FROM todos WHERE email_hash = ?');
  const insertTodo = db.prepare('INSERT INTO todos (date, dday, task, memo, deadline, todo_flag, email_hash) VALUES (?, ?, ?, ?, ?, 1, ?)');
  const crypto = require('crypto');
  const now = new Date();
  const thisYear = now.getFullYear();
  const today = now.toISOString().slice(0, 10);

  // --- 날짜 추출 함수 보강 ---
  function extractDeadlineDate(str) {
    if (!str) return null;

    // 1. (M/D), (M.D), (M-D) 또는 M/D 형식 찾기
    // 예: (2/25), 12/31, 01-15 등
    const monthDayMatch = str.match(/(\d{1,2})[\/.\-](\d{1,2})/);
    if (monthDayMatch) {
      const month = parseInt(monthDayMatch[1], 10);
      const day = parseInt(monthDayMatch[2], 10);
      
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        let year = thisYear;
        // 현재 날짜보다 추출된 날짜가 과거라면 내년으로 설정
        const candidate = new Date(year, month - 1, day);
        if (candidate < now.setHours(0, 0, 0, 0)) {
          year = thisYear + 1;
        }
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    }

    // 2. M월 D일 형식 찾기
    const korDateMatch = str.match(/(\d{1,2})월\s*(\d{1,2})일/);
    if (korDateMatch) {
      const month = parseInt(korDateMatch[1], 10);
      const day = parseInt(korDateMatch[2], 10);
      let year = thisYear;
      const candidate = new Date(year, month - 1, day);
      if (candidate < now.setHours(0, 0, 0, 0)) {
        year = thisYear + 1;
      }
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }

    // 3. YYYY-MM-DD 형식 (기존 유지)
    const fullDateMatch = str.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (fullDateMatch) return fullDateMatch[0];

    return null;
  }

  // --- 유사도 함수 (기존 유지) ---
  function normalize(str) {
    return (str || '').toLowerCase().replace(/\s+/g, '').replace(/[^\w가-힣]/g, '');
  }
  function similarity(a, b) {
    a = normalize(a); b = normalize(b);
    if (!a || !b) return 0;
    const m = a.length, n = b.length;
    const dp = Array.from({length: m+1}, () => Array(n+1).fill(0));
    for (let i=0; i<=m; i++) dp[i][0] = i;
    for (let j=0; j<=n; j++) dp[0][j] = j;
    for (let i=1; i<=m; i++) {
      for (let j=1; j<=n; j++) {
        if (a[i-1] === b[j-1]) dp[i][j] = dp[i-1][j-1];
        else dp[i][j] = 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
      }
    }
    return 1 - dp[m][n] / Math.max(m, n);
  }

  // --- 메일 루프 ---
  for (const mail of emails) {
    if (deletedMails.some(dm => (dm.subject && mail.subject && similarity(dm.subject, mail.subject) >= 0.8) || (dm.body && mail.body && similarity(dm.body, mail.body) >= 0.8))) continue;
    if (excludeKeywords.some(kw => kw && mail.subject && similarity(kw, mail.subject) >= 0.8)) continue;

    const receivedAt = mail.received_at || '';
    const uniqueId = crypto.createHash('sha256').update((receivedAt || '') + (mail.subject || '')).digest('hex');

    const existingTodo = checkExists.get(uniqueId);

    if (!existingTodo) {
      // 우선순위: 1. 제목에서 날짜 추출 -> 2. 본문에서 날짜 추출 -> 3. 기존 메일 deadline 컬럼
      let finalDeadline = extractDeadlineDate(mail.subject) || extractDeadlineDate(mail.body) || mail.deadline || '';

      insertTodo.run(
        today, 
        '', 
        mail.subject, 
        mail.body || '', 
        finalDeadline, 
        uniqueId
      );
    }
  }
}

module.exports.addTodosFromEmailTodos = addTodosFromEmailTodos;
