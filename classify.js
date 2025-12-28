// sub exclude keywords 유사도 측정 함수
function isSubExclude(subject, body, excludeKeywords, threshold = 3) {
  // excludeKeywords 배열을 sub keyword로 분해
  const subKeywords = [];
  for (const kw of excludeKeywords) {
    subKeywords.push(...kw.split(/[^가-힣a-zA-Z0-9]+/).filter(Boolean));
  }
  // 중복 제거
  const uniqueSubs = [...new Set(subKeywords.map(s => s.toLowerCase()))];
  const text = ((subject || '') + ' ' + (body || '')).toLowerCase();
  let count = 0;
  for (const sub of uniqueSubs) {
    if (sub && text.includes(sub)) count++;
    if (count >= threshold) return true;
  }
  return false;
}
const db = require('./db');

function autoClassifyEmailTodo(subject, body) {
  // exclude 키워드 체크
  let excludeKeywords = db.prepare("SELECT word FROM keywords WHERE type = 'exclude'").all().map(r => r.word);
  if (excludeKeywords.length === 1 && typeof excludeKeywords[0] === 'string' && excludeKeywords[0].includes(',')) {
    excludeKeywords = excludeKeywords[0].split(',').map(k => k.trim()).filter(Boolean);
  }
  let includeKeywords = db.prepare("SELECT word FROM keywords WHERE type = 'include'").all().map(r => r.word);
  if (includeKeywords.length === 1 && typeof includeKeywords[0] === 'string' && includeKeywords[0].includes(',')) {
    includeKeywords = includeKeywords[0].split(',').map(k => k.trim()).filter(Boolean);
  }
  const subjectText = (subject || '').toLowerCase();
  const bodyText = (body || '').toLowerCase();
  console.log('[키워드 매칭] subject:', subjectText, '| body:', bodyText);
  console.log('[키워드 매칭] excludeKeywords:', excludeKeywords);
  // sub exclude keywords 유사도(3개 이상) 체크
  if (isSubExclude(subject, body, excludeKeywords)) {
    console.log('[키워드 매칭] SUB-EXCLUDE 3개 이상 조합 매칭');
    return 9; // 무조건 제외
  }
  for (const k of excludeKeywords) {
    if (!k) continue;
    const kw = k.toLowerCase();
    // 한글 키워드 부분일치(자모 결합 포함) 정규식 매칭
    const regex = new RegExp(kw + "[\u3131-\u3163\uac00-\ud7a3]*", "g");
    if (subjectText.match(regex) || bodyText.match(regex)) {
      console.log(`[키워드 매칭] EXCLUDE 매칭(확장): '${kw}'`);
      return 9; // 무조건 제외
    }
  }
  console.log('[키워드 매칭] includeKeywords:', includeKeywords);
  for (const k of includeKeywords) {
    if (!k) continue;
    const kw = k.toLowerCase();
    // 한글 키워드 부분일치(자모 결합 포함) 정규식 매칭
    const regex = new RegExp(kw + "[\u3131-\u3163\uac00-\ud7a3]*", "g");
    if (subjectText.match(regex) || bodyText.match(regex)) {
      console.log(`[키워드 매칭] INCLUDE 매칭(확장): '${kw}'`);
      return 1; // 할일로 분류
    }
  }
  // '12/29까지', '12.29까지', '12-29까지' 등 패턴
  const deadlinePattern = /(\d{1,2})[\/.\-](\d{1,2})\s*까지/;
  if (deadlinePattern.test(subject) || deadlinePattern.test(body)) {
    console.log('[키워드 매칭] 마감일 패턴 매칭');
    return 1; // 할일로 분류
  }
  console.log('[키워드 매칭] 매칭 없음, 일반 메일');
  return 0;
}

module.exports = { autoClassifyEmailTodo };
