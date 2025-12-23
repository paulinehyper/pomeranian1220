const { ipcMain } = require('electron');
const Imap = require('imap-simple');
const Poplib = require('poplib');
const db = require('./db');
const tfClassifier = require('./tf_todo_classifier');

function getMailConfig(info) {
  // DEBUG: info.mailSince 값 확인
  console.log('[mail.js] mailConnect info.mailSince:', info.mailSince);
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
    throw new Error('메일 서버 주소(host)를 입력해야 합니다.');
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
    user: info.mailId || info.mail_id,
    password: info.mailPw || info.mail_pw,
    host: resolvedHost,
    port,
    tls,
    authTimeout: 5000,
    tlsOptions: { rejectUnauthorized: false }
  };
}


function setupMailIpc(main) {
  // 날짜 필터링 함수: 환경설정 mailSince와 DB의 마지막 메일 날짜 중 더 최신 기준 사용
  function getSearchCriteria(info) {
    let searchCriteria = ["ALL"];
    const mailSince = info.mailSince || info.mail_since;
    if (mailSince) {
      const sinceDate = new Date(mailSince);
      if (!isNaN(sinceDate.getTime())) {
        searchCriteria = [["SINCE", sinceDate]];
      }
    }
    const lastEmail = db.prepare('SELECT received_at FROM emails ORDER BY received_at DESC LIMIT 1').get();
    if (lastEmail && lastEmail.received_at) {
      const lastDate = new Date(lastEmail.received_at);
      if (!isNaN(lastDate.getTime())) {
        // 기존 조건보다 DB의 마지막 날짜가 더 최신이면 덮어씌움
        searchCriteria = [["SINCE", lastDate]];
      }
    }
    return searchCriteria;
  }


  async function syncMail(info) {
    await tfClassifier.train();
    const config = getMailConfig(info);
    if (info.protocol.startsWith('imap')) {
      // 기존 IMAP 로직
      try {
        const conn = await Imap.connect({ imap: config });
        await conn.openBox('INBOX');
        const searchCriteria = getSearchCriteria(info);
        console.log('[syncMail] 검색 조건:', JSON.stringify(searchCriteria));
        const fetchOptions = { bodies: ["HEADER", "TEXT"], struct: true };
        const messages = await conn.search(searchCriteria, fetchOptions);
        console.log(`[syncMail] 검색된 새 메일: ${messages.length}건`);
        const { simpleParser } = require('mailparser');
        const crypto = require('crypto');
        const exists = db.prepare('SELECT COUNT(*) as cnt FROM emails WHERE unique_hash = ?');
        for (const msg of messages) {
          try {
            const headerPart = msg.parts.find(p => p.which === 'HEADER');
            const textPart = msg.parts.find(p => p.which === 'TEXT');
            let subject = '', from = '', date = '';
            if (headerPart && headerPart.body) {
              subject = Array.isArray(headerPart.body.subject) ? headerPart.body.subject[0] : (headerPart.body.subject || '');
              from = Array.isArray(headerPart.body.from) ? headerPart.body.from[0] : (headerPart.body.from || '');
              date = Array.isArray(headerPart.body.date) ? headerPart.body.date[0] : (headerPart.body.date || '');
            }
            let body = '';
            if (textPart && textPart.body) {
              const { simpleParser } = require('mailparser');
              const { htmlToText } = require('html-to-text');
              const qp = require('quoted-printable');
              const iconv = require('iconv-lite');
              let rawBody = textPart.body;
              if (typeof rawBody === 'string' && /=\d{2}/i.test(rawBody)) {
                try {
                  rawBody = qp.decode(rawBody);
                  let charset = 'utf-8';
                  if (headerPart && headerPart.body && headerPart.body['content-type']) {
                    const ct = Array.isArray(headerPart.body['content-type']) ? headerPart.body['content-type'][0] : headerPart.body['content-type'];
                    const match = ct.match(/charset\s*=\s*"?([a-zA-Z0-9\-]+)"?/i);
                    if (match && match[1]) charset = match[1].toLowerCase();
                  }
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
              todoFlag = await tfClassifier.predictTodo(subject + ' ' + body);
            } catch (e) {
              todoFlag = null;
            }
            const finalDeadline = extractDeadline(subject) || extractDeadline(body);
            if (!exists.get(hash).cnt) {
              const createdAt = info.mailSince || new Date().toISOString();
              const emailHash = require('crypto').createHash('sha256').update((date||'') + (subject||'')).digest('hex');
              db.prepare('INSERT INTO emails (received_at, subject, body, from_addr, todo_flag, unique_hash, deadline, created_at, email_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
                .run(date, subject, body, from, todoFlag, hash, finalDeadline, createdAt, emailHash);
            }
          } catch (e) { /* 무시 */ }
        }
        await conn.end();
        return { success: true, count: messages.length };
      } catch (e) {
        console.error('syncMail(IMAP) 에러:', e);
        return { success: false, message: e.message };
      }
    } else if (info.protocol.startsWith('pop3')) {
      // POP3 연동 로직
      return new Promise((resolve) => {
        const Pop3 = Poplib;
        const { host, port, tls, user, password } = config;
        const client = new Pop3(port, host, {
          tlserrs: false,
          enabletls: tls,
          debug: false
        });
        let mailCount = 0;
        let current = 1;
        let messages = [];
        let errorMsg = null;
        client.on('error', function(err) {
          errorMsg = err.message;
          client.quit();
        });
        client.on('connect', function() {
          client.login(user, password);
        });
        client.on('login', function(status, rawdata) {
          if (status) {
            client.stat();
          } else {
            errorMsg = 'POP3 로그인 실패';
            client.quit();
          }
        });
        client.on('stat', function(status, data) {
          if (status && data[0] > 0) {
            mailCount = data[0];
            fetchNext();
          } else {
            client.quit();
          }
        });
        function fetchNext() {
          if (current > mailCount) {
            client.quit();
            return;
          }
          client.retr(current);
        }
        client.on('retr', async function(status, msgnumber, data, rawdata) {
          if (status) {
            try {
              const { simpleParser } = require('mailparser');
              const parsed = await simpleParser(data);
              const subject = parsed.subject || '';
              const from = parsed.from && parsed.from.text ? parsed.from.text : '';
              const date = parsed.date ? new Date(parsed.date).toISOString() : '';
              const body = parsed.text || '';
              const crypto = require('crypto');
              const hash = crypto.createHash('sha256').update((subject||'')+(body||'')+(from||'')+(date||'')).digest('hex');
              const exists = db.prepare('SELECT COUNT(*) as cnt FROM emails WHERE unique_hash = ?');
              let todoFlag = null;
              try {
                todoFlag = await tfClassifier.predictTodo(subject + ' ' + body);
              } catch (e) { todoFlag = null; }
              const finalDeadline = extractDeadline(subject) || extractDeadline(body);
              if (!exists.get(hash).cnt) {
                const createdAt = info.mailSince || new Date().toISOString();
                const emailHash = require('crypto').createHash('sha256').update((date||'') + (subject||'')).digest('hex');
                db.prepare('INSERT INTO emails (received_at, subject, body, from_addr, todo_flag, unique_hash, deadline, created_at, email_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
                  .run(date, subject, body, from, todoFlag, hash, finalDeadline, createdAt, emailHash);
              }
            } catch (e) { /* 무시 */ }
          }
          current++;
          fetchNext();
        });
        client.on('quit', function() {
          if (errorMsg) {
            resolve({ success: false, message: errorMsg });
          } else {
            resolve({ success: true, count: mailCount });
          }
        });
      });
    } else {
      return { success: false, message: '지원하지 않는 프로토콜입니다.' };
    }
  }


  module.exports.syncMail = syncMail;

  ipcMain.handle('mail-connect', async (event, info) => {
    return await syncMail(info);
  });
}

// 기존 extractDeadline 함수 유지
function extractDeadline(text) {
  if (!text) return null;
  const patterns = [
    /\b(\d{4})[./-년\s]+(\d{1,2})[./-월\s]+(\d{1,2})[일\s]*\b/,
    /\b(\d{1,2})[\/.](\d{1,2})\b/,
    /(\d{1,2})월\s*(\d{1,2})일/
  ];
  for (let i = 0; i < patterns.length; i++) {
    const match = text.match(patterns[i]);
    if (match) {
      let y, m, d;
      const now = new Date();
      const currentYear = now.getFullYear();
      if (i === 0) {
        y = parseInt(match[1]);
        m = parseInt(match[2]);
        d = parseInt(match[3]);
      } else {
        m = parseInt(match[1]);
        d = parseInt(match[2]);
        let targetDate = new Date(currentYear, m - 1, d);
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        y = (targetDate < today) ? currentYear + 1 : currentYear;
      }
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        const formattedDate = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        console.log(`[날짜 추출 성공] "${text.substring(0, 20)}..." -> ${formattedDate}`);
        return formattedDate;
      }
    }
  }
  return null;
}

module.exports = setupMailIpc;
