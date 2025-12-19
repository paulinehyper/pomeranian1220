const { ipcMain } = require('electron');
const Imap = require('imap-simple');
const db = require('./db');
const tfClassifier = require('./tf_todo_classifier');

function getImapConfig(info) {
  let resolvedHost = '';
  let port, tls;
  if (info.host && info.host.trim()) {
    resolvedHost = info.host.trim();
  } else if (info.mail_server && info.mail_server.trim()) {
    resolvedHost = info.mail_server.trim();
  } else if (info.mailServer && info.mailServer.trim()) {
    resolvedHost = info.mailServer.trim();
  } else {
    resolvedHost = '';
  }
  if (!resolvedHost) {
    throw new Error('IMAP 서버 주소(host)를 입력해야 합니다.');
  }
  if (info.protocol === 'imap-ssl' || info.protocol === 'imap-secure') {
    port = 993; tls = true;
  } else if (info.protocol === 'imap') {
    port = 143; tls = false;
  } else if (info.protocol === 'pop3-ssl' || info.protocol === 'pop3-secure') {
    port = 995; tls = true;
  } else if (info.protocol === 'pop3') {
    port = 110; tls = false;
  }
  return {
    imap: {
      user: info.mailId || info.mail_id,
      password: info.mailPw || info.mail_pw,
      host: resolvedHost,
      port,
      tls,
      authTimeout: 5000,
      tlsOptions: { rejectUnauthorized: false }
    }
  };
}

function setupMailIpc(main) {
  // 내부에서 직접 호출 가능한 syncMail 함수 export
  async function syncMail(info) {
    // TensorFlow 모델 훈련 (앱 시작 시 1회만 하면 됨, 여기선 매번 호출)
    await tfClassifier.train();
    console.log('[syncMail] called with info:', info);
    if (info.protocol.startsWith('imap')) {
      const config = getImapConfig(info);
      console.log('[syncMail] IMAP config:', config);
      try {
        const conn = await Imap.connect(config);
        console.log('[syncMail] IMAP connected');
        const box = await conn.openBox('INBOX');
        console.log('[syncMail] INBOX opened');
        let searchCriteria = [];
        if (info.mailSince) {
          // mailSince가 오늘이면 하루 전으로 보정
          let sinceDate = new Date(info.mailSince);
          const today = new Date();
          if (
            sinceDate.getFullYear() === today.getFullYear() &&
            sinceDate.getMonth() === today.getMonth() &&
            sinceDate.getDate() === today.getDate()
          ) {
            // 하루 전으로 보정
            sinceDate.setDate(sinceDate.getDate() - 1);
          }
          searchCriteria = [["SINCE", sinceDate]];
        } else {
          searchCriteria = ["ALL"];
        }
        console.log('[syncMail] searchCriteria:', searchCriteria);
        const fetchOptions = {
          bodies: ["HEADER", "TEXT"],
          struct: true
        };
        const messages = await conn.search(searchCriteria, fetchOptions);
        console.log(`[syncMail] messages found: ${messages.length}`);
        const { simpleParser } = require('mailparser');
        const crypto = require('crypto');
        const insert = db.prepare('INSERT INTO emails (received_at, subject, body, from_addr, todo_flag, unique_hash, deadline) VALUES (?, ?, ?, ?, ?, ?, ?)');
        const exists = db.prepare('SELECT COUNT(*) as cnt FROM emails WHERE unique_hash = ?');
        function extractDeadline(body) {
          if (!body) return null;
          const patterns = [
            /(\d{4})[./-](\d{1,2})[./-](\d{1,2})/,
            /(\d{1,2})[./-](\d{1,2})/,
            /(\d{1,2})월\s?(\d{1,2})일/,
            /(\d{1,2})일/,
            /(\d{1,2})일까지/
          ];
          for (const re of patterns) {
            const m = body.match(re);
            if (m) {
              if (m.length >= 4 && m[1].length === 4) {
                return `${m[1]}/${m[2].padStart(2,'0')}/${m[3].padStart(2,'0')}`;
              } else if (m.length >= 3 && re === patterns[1]) {
                return `${new Date().getFullYear()}/${m[1].padStart(2,'0')}/${m[2].padStart(2,'0')}`;
              } else if (m.length >= 3 && re === patterns[2]) {
                return `${new Date().getFullYear()}/${m[1].padStart(2,'0')}/${m[2].padStart(2,'0')}`;
              } else if (m.length >= 2 && (re === patterns[3] || re === patterns[4])) {
                return `${new Date().getFullYear()}/${(new Date().getMonth()+1).toString().padStart(2,'0')}/${m[1].padStart(2,'0')}`;
              }
            }
          }
          const yearMonthDay = body.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
          if (yearMonthDay) {
            return `${yearMonthDay[1]}/${yearMonthDay[2].padStart(2,'0')}/${yearMonthDay[3].padStart(2,'0')}`;
          }
          return null;
        }
        for (const msg of messages) {
          try {
            // HEADER와 TEXT 파트 분리
            const headerPart = msg.parts.find(p => p.which === 'HEADER');
            const textPart = msg.parts.find(p => p.which === 'TEXT');
            // HEADER 파싱
            let subject = '', from = '', date = '';
            if (headerPart && headerPart.body) {
              subject = Array.isArray(headerPart.body.subject) ? headerPart.body.subject[0] : (headerPart.body.subject || '');
              from = Array.isArray(headerPart.body.from) ? headerPart.body.from[0] : (headerPart.body.from || '');
              date = Array.isArray(headerPart.body.date) ? headerPart.body.date[0] : (headerPart.body.date || '');
            }
            // 본문 파싱: quoted-printable 인코딩 자동 디코딩
            let body = '';
            if (textPart && textPart.body) {
              const { simpleParser } = require('mailparser');
              const { htmlToText } = require('html-to-text');
              const qp = require('quoted-printable');
              const iconv = require('iconv-lite');
              let rawBody = textPart.body;
              // quoted-printable 디코딩 시도
              if (typeof rawBody === 'string' && /=[0-9A-F]{2}/i.test(rawBody)) {
                try {
                  rawBody = qp.decode(rawBody);
                  // charset 추출 시도 (헤더에서)
                  let charset = 'utf-8';
                  if (headerPart && headerPart.body && headerPart.body['content-type']) {
                    const ct = Array.isArray(headerPart.body['content-type']) ? headerPart.body['content-type'][0] : headerPart.body['content-type'];
                    const match = ct.match(/charset\s*=\s*"?([a-zA-Z0-9\-]+)"?/i);
                    if (match && match[1]) charset = match[1].toLowerCase();
                  }
                  // iconv로 charset 변환
                  rawBody = iconv.decode(Buffer.from(rawBody, 'binary'), charset);
                } catch (e) { /* 무시 */ }
              }
              try {
                const parsed = await simpleParser(rawBody);
                if (parsed.html) {
                  body = htmlToText(parsed.html, { wordwrap: false });
                } else if (parsed.text) {
                  body = parsed.text;
                } else {
                  body = rawBody.toString();
                }
              } catch (e) {
                body = rawBody.toString();
              }
            }
            const hash = crypto.createHash('sha256').update((subject||'')+(body||'')+(from||'')+(date||'')).digest('hex');
            let todoFlag = null;
            try {
              // TensorFlow.js로 본문 분류
              todoFlag = await tfClassifier.predictTodo(subject + ' ' + body);
            } catch (e) {
              todoFlag = null;
            }
            if (!exists.get(hash).cnt) {
              insert.run(date, subject, body, from, todoFlag, hash, extractDeadline(body));
            }
          } catch (e) { /* 무시 */ }
        }
        return { success: true };
      } catch (e) {
        return { success: false, message: e && (e.stack || e.message || JSON.stringify(e)) };
      }
    } else {
      return { success: false, message: '지원하지 않는 프로토콜' };
    }
  }

  // 외부에서 직접 호출 가능하도록 export
  module.exports.syncMail = syncMail;
  // 다양한 타입을 안전하게 Buffer로 변환
  function toBuffer(body) {
    if (Buffer.isBuffer(body)) return body;
    if (typeof body === 'string') return Buffer.from(body);
    if (body && typeof body === 'object' && body.type === 'Buffer' && Array.isArray(body.data)) {
      return Buffer.from(body.data);
    }
    return Buffer.alloc(0);
  }
  ipcMain.handle('mail-connect', async (event, info) => {
    if (info.protocol.startsWith('imap')) {
      // IMAP 메일 가져와서 DB 저장
      const config = getImapConfig(info);
      try {
        const conn = await Imap.connect(config);
        const box = await conn.openBox('INBOX');
        let searchCriteria = [];
        if (info.mailSince) {
          searchCriteria = [["SINCE", new Date(info.mailSince)]];
        } else {
          searchCriteria = ["ALL"];
        }
        const fetchOptions = {
          bodies: ["HEADER", "TEXT"],
          struct: true
        };
        const messages = await conn.search(searchCriteria, fetchOptions);
        console.log('[IMAP] 검색된 메일 개수:', messages.length);
        const { simpleParser } = require('mailparser');
        const crypto = require('crypto');
        const insert = db.prepare('INSERT INTO emails (received_at, subject, body, from_addr, todo_flag, unique_hash, deadline) VALUES (?, ?, ?, ?, ?, ?, ?)');
        const exists = db.prepare('SELECT COUNT(*) as cnt FROM emails WHERE unique_hash = ?');
        function extractDeadline(body) {
          if (!body) return null;
          const patterns = [
            /(\d{4})[./-](\d{1,2})[./-](\d{1,2})/,
            /(\d{1,2})[./-](\d{1,2})/,
            /(\d{1,2})월\s?(\d{1,2})일/,
            /(\d{1,2})일/,
            /(\d{1,2})일까지/
          ];
          for (const re of patterns) {
            const m = body.match(re);
            if (m) {
              if (m.length >= 4 && m[1].length === 4) {
                return `${m[1]}/${m[2].padStart(2,'0')}/${m[3].padStart(2,'0')}`;
              } else if (m.length >= 3 && re === patterns[1]) {
                return `${new Date().getFullYear()}/${m[1].padStart(2,'0')}/${m[2].padStart(2,'0')}`;
              } else if (m.length >= 3 && re === patterns[2]) {
                return `${new Date().getFullYear()}/${m[1].padStart(2,'0')}/${m[2].padStart(2,'0')}`;
              } else if (m.length >= 2 && (re === patterns[3] || re === patterns[4])) {
                return `${new Date().getFullYear()}/${(new Date().getMonth()+1).toString().padStart(2,'0')}/${m[1].padStart(2,'0')}`;
              }
            }
          }
          const yearMonthDay = body.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
          if (yearMonthDay) {
            return `${yearMonthDay[1]}/${yearMonthDay[2].padStart(2,'0')}/${yearMonthDay[3].padStart(2,'0')}`;
          }
          return null;
        }
        for (const msg of messages) {
          try {
            // HEADER와 TEXT 파트 분리
            const headerPart = msg.parts.find(p => p.which === 'HEADER');
            const textPart = msg.parts.find(p => p.which === 'TEXT');
            // HEADER 파싱
            let subject = '', from = '', date = '';
            if (headerPart && headerPart.body) {
              subject = Array.isArray(headerPart.body.subject) ? headerPart.body.subject[0] : (headerPart.body.subject || '');
              from = Array.isArray(headerPart.body.from) ? headerPart.body.from[0] : (headerPart.body.from || '');
              date = Array.isArray(headerPart.body.date) ? headerPart.body.date[0] : (headerPart.body.date || '');
            }
            // 본문 파싱: 항상 simpleParser로 html/text 우선순위 저장
            let body = '';
            if (textPart && textPart.body) {
              const { simpleParser } = require('mailparser');
              try {
                const parsed = await simpleParser(textPart.body);
                if (parsed.html) {
                  body = parsed.html;
                } else if (parsed.text) {
                  body = parsed.text;
                } else {
                  body = textPart.body;
                }
              } catch (e) {
                body = textPart.body;
              }
            }
            // 날짜 ISO 포맷 변환
            let isoDate = '';
            if (date) {
              const d = new Date(date);
              if (!isNaN(d)) isoDate = d.toISOString();
            }
            const hash = crypto.createHash('sha256').update((isoDate || date) + subject).digest('hex');
            const text = (subject + ' ' + body).toLowerCase();
            const deadlinePatterns = [
              /\d{1,2}월\s?\d{1,2}일.*(제출|요청|회신|완료|필요|해달라|해 주세요|해주십시오)/,
              /\d{1,2}일까지.*(제출|요청|회신|완료|필요|해달라|해 주세요|해주십시오)/,
              /\d{1,2}일.*(제출|요청|회신|완료|필요|해달라|해 주세요|해주십시오)/,
              /by\s+\d{1,2}[./-]\d{1,2}/i,
              /submit.*by.*\d{1,2}[./-]\d{1,2}/i,
              /~\s*\d{1,2}[./-]\d{1,2}.*(요청|제출|회신|필요)/i
            ];
            let todoFlag = 0;
            const defaultKeywords = [
              '요청', '제출', '회신', '완료', '필요', '해달라', '해 주세요', '해주십시오',
              'request', 'submit', 'reply', 'complete', 'need', 'please', 'due', 'until', 'by'
            ];
            try {
              let keywords = [];
              if (db.getAllKeywords) {
                keywords = db.getAllKeywords() || [];
              }
              const allKeywords = Array.from(new Set([
                ...defaultKeywords.map(k => k.toLowerCase()),
                ...keywords.map(k => (typeof k === 'string' ? k.toLowerCase() : (k.keyword || '').toLowerCase()))
              ])).filter(Boolean);
              if (allKeywords.some(kw => kw && text.includes(kw))) {
                todoFlag = 1;
              }
            } catch (e) {}
            if (deadlinePatterns.some(re => text.match(re))) {
              todoFlag = 1;
            }
            const deadline = extractDeadline(subject + ' ' + body);
            console.log(`[IMAP] 메일: subject="${subject}", from="${from}", date="${isoDate || date}"`);
            if (exists.get(hash).cnt === 0) {
              try {
                insert.run(isoDate || date, subject, body, from, todoFlag, hash, deadline);
                console.log(`[IMAP] DB 저장 성공: subject="${subject}"`);
              } catch (err) {
                console.error(`[IMAP] DB 저장 실패: subject="${subject}", error=`, err);
              }
            } else {
              console.log(`[IMAP] 이미 저장된 메일: subject="${subject}"`);
            }
          } catch (err) {
            console.error('[IMAP] 메일 파싱/저장 중 오류:', err);
          }
        }
        await conn.end();
        return { success: true, message: '연동완료!' };
      } catch (e) {
        console.error('IMAP 연동실패:', e && (e.stack || e.message || e));
        return { success: false, message: '연동실패: ' + (e && (e.stack || e.message || JSON.stringify(e))) };
      }
    } else if (info.protocol.startsWith('pop3')) {
      // POP3 연동 (node-poplib)
      try {
        const Pop3Client = require('poplib');
        const { simpleParser } = require('mailparser');
        const crypto = require('crypto');
        const insert = db.prepare('INSERT INTO emails (received_at, subject, body, from_addr, todo_flag, unique_hash, deadline) VALUES (?, ?, ?, ?, ?, ?, ?)');
        const exists = db.prepare('SELECT COUNT(*) as cnt FROM emails WHERE unique_hash = ?');
        // extractDeadline 함수 재사용
        function extractDeadline(body) {
          if (!body) return null;
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
                return `${m[1]}/${m[2].padStart(2,'0')}/${m[3].padStart(2,'0')}`;
              } else if (m.length >= 3 && re === patterns[1]) {
                return `${new Date().getFullYear()}/${m[1].padStart(2,'0')}/${m[2].padStart(2,'0')}`;
              } else if (m.length >= 3 && re === patterns[2]) {
                return `${new Date().getFullYear()}/${m[1].padStart(2,'0')}/${m[2].padStart(2,'0')}`;
              } else if (m.length >= 2 && (re === patterns[3] || re === patterns[4])) {
                return `${new Date().getFullYear()}/${(new Date().getMonth()+1).toString().padStart(2,'0')}/${m[1].padStart(2,'0')}`;
              }
            }
          }
          const yearMonthDay = body.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
          if (yearMonthDay) {
            return `${yearMonthDay[1]}/${yearMonthDay[2].padStart(2,'0')}/${yearMonthDay[3].padStart(2,'0')}`;
          }
          return null;
        }
        // POP3 연결
        // poplib: new POP3Client(port, host, options)
        const pop3 = new Pop3Client(
          info.protocol === 'pop3-ssl' ? 995 : 110,
          info.mail_server,
          {
            tlserrs: false,
            enabletls: info.protocol === 'pop3-ssl',
            debug: false
          }
        );
        return await new Promise((resolve, reject) => {
          pop3.on('error', err => {
            resolve({ success: false, message: 'POP3 연동실패: ' + (err && (err.stack || err.message || JSON.stringify(err))) });
          });
          pop3.on('connect', () => {
            pop3.login(info.mailId, info.mailPw);
          });
          pop3.on('login', (status, rawdata) => {
            if (!status) {
              resolve({ success: false, message: 'POP3 로그인 실패: ' + rawdata });
              pop3.quit();
              return;
            }
            pop3.list();
          });
          pop3.on('list', (status, msgcount) => {
            if (!status || !msgcount) {
              resolve({ success: false, message: 'POP3 메일 없음' });
              pop3.quit();
              return;
            }
            let fetched = 0;
            let done = false;
            for (let i = 1; i <= msgcount; i++) {
              pop3.retr(i);
            }
            pop3.on('retr', async (msgnum, data) => {
              fetched++;
              try {
                const parsed = await simpleParser(data);
                let body = parsed.text || '';
                if (!body && parsed.html) {
                  const { htmlToText } = require('html-to-text');
                  body = htmlToText(parsed.html, { wordwrap: false });
                }
                const subject = parsed.subject || '';
                const from = parsed.from?.text || '';
                const date = parsed.date?.toISOString() || '';
                const hash = crypto.createHash('sha256').update(date + subject).digest('hex');
                const text = (subject + ' ' + body).toLowerCase();
                const deadlinePatterns = [
                  /\d{1,2}월\s?\d{1,2}일.*(제출|요청|회신|완료|필요|해달라|해 주세요|해주십시오)/,
                  /\d{1,2}일까지.*(제출|요청|회신|완료|필요|해달라|해 주세요|해주십시오)/,
                  /\d{1,2}일.*(제출|요청|회신|완료|필요|해달라|해 주세요|해주십시오)/,
                  /by\s+\d{1,2}[./-]\d{1,2}/i,
                  /submit.*by.*\d{1,2}[./-]\d{1,2}/i,
                  /~\s*\d{1,2}[./-]\d{1,2}.*(요청|제출|회신|필요)/i
                ];
                let todoFlag = 0;
                const defaultKeywords = [
                  '요청', '제출', '회신', '완료', '필요', '해달라', '해 주세요', '해주십시오',
                  'request', 'submit', 'reply', 'complete', 'need', 'please', 'due', 'until', 'by'
                ];
                try {
                  let keywords = [];
                  if (db.getAllKeywords) {
                    keywords = db.getAllKeywords() || [];
                  }
                  const allKeywords = Array.from(new Set([
                    ...defaultKeywords.map(k => k.toLowerCase()),
                    ...keywords.map(k => (typeof k === 'string' ? k.toLowerCase() : (k.keyword || '').toLowerCase()))
                  ])).filter(Boolean);
                  if (allKeywords.some(kw => kw && text.includes(kw))) {
                    todoFlag = 1;
                  }
                } catch (e) {}
                if (deadlinePatterns.some(re => text.match(re))) {
                  todoFlag = 1;
                }
                const deadline = extractDeadline(subject + ' ' + body);
                if (exists.get(hash).cnt === 0) {
                  insert.run(date, subject, body, from, todoFlag, hash, deadline);
                }
              } catch (e) {}
              if (fetched === msgcount && !done) {
                done = true;
                pop3.quit();
                resolve({ success: true, message: 'POP3 연동완료!' });
              }
            });
          });
        });
      } catch (e) {
        console.error('POP3 연동실패:', e && (e.stack || e.message || e));
        return { success: false, message: 'POP3 연동실패: ' + (e && (e.stack || e.message || JSON.stringify(e))) };
      }
    } else {
      return { success: false, message: '지원하지 않는 프로토콜' };
    }
  });
}

module.exports = setupMailIpc;
