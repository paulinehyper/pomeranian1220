const { ipcMain } = require('electron');
const Imap = require('imap-simple');
const db = require('./db');
const tfClassifier = require('./tf_todo_classifier');

function getImapConfig(info) {
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
    if (!info.protocol.startsWith('imap')) return { success: false, message: 'IMAP만 지원' };
    const config = getImapConfig(info);
    try {
      const conn = await Imap.connect(config);
      await conn.openBox('INBOX');
      const searchCriteria = getSearchCriteria(info);
      console.log('[syncMail] 검색 조건:', JSON.stringify(searchCriteria));
      const fetchOptions = { bodies: ["HEADER", "TEXT"], struct: true };
      const messages = await conn.search(searchCriteria, fetchOptions);
      console.log(`[syncMail] 검색된 새 메일: ${messages.length}건`);
      // ...기존 메일 파싱 및 DB 저장 로직...
      const { simpleParser } = require('mailparser');
      const crypto = require('crypto');
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
          if (!exists.get(hash).cnt) {
            const createdAt = info.mailSince || new Date().toISOString();
            // subject+received_at 해시 생성
            const emailHash = require('crypto').createHash('sha256').update((date||'') + (subject||'')).digest('hex');
            db.prepare('INSERT INTO emails (received_at, subject, body, from_addr, todo_flag, unique_hash, deadline, created_at, email_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
              .run(date, subject, body, from, todoFlag, hash, extractDeadline(body), createdAt, emailHash);
          }
        } catch (e) { /* 무시 */ }
      }
      await conn.end();
      return { success: true, count: messages.length };
    } catch (e) {
      console.error('syncMail 에러:', e);
      return { success: false, message: e.message };
    }
  }

  module.exports.syncMail = syncMail;

  ipcMain.handle('mail-connect', async (event, info) => {
    return await syncMail(info);
  });
}

module.exports = setupMailIpc;
