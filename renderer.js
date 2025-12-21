// ...renderer.js의 나머지 코드만 유지...
console.log('renderer.js loaded');
// 환경설정(톱니바퀴) 아이콘 클릭 시 app-settings.html 새 창 열기
document.addEventListener('DOMContentLoaded', () => {
  const cogBtn = document.querySelector('.cog-btn');
  if (cogBtn) {
    cogBtn.addEventListener('click', () => {
      window.electronAPI.openAppSettings();
    });
  }
});
// 할일 추가 플로팅 버튼 및 모달 동작
document.addEventListener('DOMContentLoaded', () => {
  const fab = document.getElementById('add-todo-fab');
  const modal = document.getElementById('add-todo-modal');
  const closeBtn = document.getElementById('close-add-todo-modal');
  const saveBtn = document.getElementById('save-add-todo');
  const taskInput = document.getElementById('add-todo-task');
  const deadlineInput = document.getElementById('add-todo-deadline');
  if (fab && modal && closeBtn && saveBtn && taskInput && deadlineInput) {
    fab.onclick = () => {
      modal.style.display = 'flex';
      taskInput.value = '';
      deadlineInput.value = '';
      setTimeout(() => taskInput.focus(), 100);
    };
    closeBtn.onclick = () => { modal.style.display = 'none'; };
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
    saveBtn.onclick = async () => {
      const task = taskInput.value.trim();
      const deadline = deadlineInput.value;
      if (!task) { taskInput.focus(); return; }
      // DB에 저장 (electronAPI에 insertTodo가 있다고 가정)
      await window.electronAPI.insertTodo({ task, deadline });
      modal.style.display = 'none';
      const todos = await fetchTodos();
      renderList(todos);
    };
    taskInput.addEventListener('keydown', e => { if (e.key === 'Enter') saveBtn.click(); });
    deadlineInput.addEventListener('keydown', e => { if (e.key === 'Enter') saveBtn.click(); });
  }
});
// 완료된 할일 목록 가져오기
async function fetchCompletedTodos() {
  return (await window.electronAPI.getTodos()).filter(todo => todo.todo_flag === 2);
}

function renderCompletedList(todos) {
  const list = document.getElementById('completed-list');
  list.innerHTML = '';
  if (!todos.length) {
    list.innerHTML = '<li style="color:#888;">완료된 할일이 없습니다.</li>';
    return;
  }
  todos.forEach(todo => {
    const li = document.createElement('li');
    li.style.marginBottom = '8px';
    li.innerHTML = `<span style="text-decoration:line-through;color:#00b49cff;">${todo.task}</span> <span style="color:#b48a00;">${todo.deadline ? '('+todo.deadline+')' : ''}</span>`;
    list.appendChild(li);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const completedBtn = document.querySelector('.completed-btn');
  const completedModal = document.getElementById('completed-modal');
  const closeCompletedModal = document.getElementById('close-completed-modal');
  if (completedBtn && completedModal && closeCompletedModal) {
    completedBtn.addEventListener('click', async () => {
      const completed = await fetchCompletedTodos();
      renderCompletedList(completed);
      completedModal.style.display = 'flex';
    });
    closeCompletedModal.addEventListener('click', () => {
      completedModal.style.display = 'none';
    });
    completedModal.addEventListener('click', (e) => {
      if (e.target === completedModal) completedModal.style.display = 'none';
    });
  }
});
async function fetchTodos() {
  return await window.electronAPI.getTodos();
}

function renderList(todos) {
    // 헤더의 할일 개수 뱃지 갱신 (완료된 할일 제외)
    const badge = document.getElementById('todo-count-badge');
    if (badge) {
      const notCompleted = todos ? todos.filter(t => {
        // 이메일 기반: todo_flag === 2가 완료, 일반: style로만 취소선(아래에서 처리)
        return !(typeof t.id === 'string' && t.id.startsWith('mail-') ? t.todo_flag === 2 : false);
      }) : [];
      badge.textContent = notCompleted.length;
    }
  const list = document.querySelector('.schedule-list');
  // todo_flag=2(완료)인 항목은 홈화면에서 제외
  const filteredTodos = todos ? todos.filter(t => t.todo_flag !== 2) : [];
  list.innerHTML = '';
  if (!filteredTodos || filteredTodos.length === 0) {
    const li = document.createElement('li');
    li.textContent = '할일이 없습니다.';
    li.style.color = '#888';
    li.style.textAlign = 'center';
    list.appendChild(li);
    return;
  }
  let dragSrcIdx = null;
  // 이메일(todo_flag 있는 mail- id)은 최신순, 일반 할일은 데드라인순
  const sortedTodos = [...filteredTodos].sort((a, b) => {
    const isMailA = typeof a.id === 'string' && a.id.startsWith('mail-');
    const isMailB = typeof b.id === 'string' && b.id.startsWith('mail-');
    if (isMailA && isMailB) {
      // 최신순(내림차순)
      return new Date(b.received_at || b.deadline || 0) - new Date(a.received_at || a.deadline || 0);
    } else if (!isMailA && !isMailB) {
      // 일반 할일: 데드라인 빠른 순
      if (!a.deadline || a.deadline === '없음') return 1;
      if (!b.deadline || b.deadline === '없음') return -1;
      return new Date(a.deadline) - new Date(b.deadline);
    } else {
      // 이메일이 위에 오도록
      return isMailA ? -1 : 1;
    }
  });
  sortedTodos.forEach((item, idx) => {
    const li = document.createElement('li');
    li.setAttribute('draggable', 'true');
    li.setAttribute('data-idx', idx);
    // ...existing code...
    const memo = item.memo || '';
    let deadlineHtml = '';
    let isUrgent = false;
    if (item.deadline && item.deadline !== '없음' && item.deadline !== item.date) {
      deadlineHtml = `<span class="deadline" style="color:#00b49cff;font-weight:bold;margin-right:6px;">마감: ${item.deadline}</span>`;
      const today = new Date();
      const deadlineDate = new Date(item.deadline);
      today.setHours(0,0,0,0);
      deadlineDate.setHours(0,0,0,0);
      if (deadlineDate <= today) isUrgent = true;
    }
    const isMail = typeof item.id === 'string' && item.id.startsWith('mail-');
    const isCompleted = item.todo_flag === 2;
    li.innerHTML = `
      ${deadlineHtml}
      <span class="date">${item.date} </span>
      <span style="display:inline-block;width:8px;"></span>
      <span class="d-day">${item.dday}</span>
      <span style="display:inline-block;width:8px;"></span>
      <span class="task" style="${isCompleted ? 'text-decoration:line-through;color:#aaa;' : ''}">${item.task}</span>
      <button class="memo-edit-btn" title="메모 추가/수정" style="background:transparent;border:none;cursor:pointer;margin-left:8px;">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="3" y="3" width="18" height="18" rx="3" fill="#7affcaff" stroke="#00b49cff" stroke-width="1.5"/>
          <path d="M16 21v-4a1 1 0 0 1 1-1h4" stroke="#00b478ff" stroke-width="1.5" fill="#ffffffff"/>
        </svg>
      </button>
      <button class="exclude-btn" title="할일 목록에서 제외" style="background:transparent;border:none;cursor:pointer;margin-left:4px;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="4" y="4" width="16" height="16" rx="3" fill="#e0e0e0" stroke="#888" stroke-width="1.5"/>
          <path d="M8 12h8" stroke="#888" stroke-width="2"/>
        </svg>
      </button>
      <textarea class="memo" placeholder="메모/부연설명" rows="2" style="display:none;">${memo}</textarea>
      <button class="complete-check-btn" title="완료 체크" style="display:${isCompleted ? 'inline-block' : 'none'};background:transparent;border:none;cursor:pointer;margin-left:4px;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="9" fill="#00b49cff" stroke="#00b49cff" stroke-width="1.5"/>
          <path d="M8 12l3 3 5-5" stroke="#fff" stroke-width="2" fill="none"/>
        </svg>
      </button>
    `;
    if (isUrgent) li.classList.add('urgent-blink');
        // 할일 제목 클릭 시 취소선 토글
        const taskSpan = li.querySelector('.task');
        if (taskSpan) {
          taskSpan.addEventListener('click', async (e) => {
            console.log('taskSpan 클릭됨', item);
            let isNowCompleted = false;
            const checkBtn = li.querySelector('.complete-check-btn');
            if (taskSpan.style.textDecoration === 'line-through') {
              // 취소선 해제: 미완료로 변경 (todo_flag=1)
              taskSpan.style.textDecoration = '';
              taskSpan.style.color = '';
              isNowCompleted = false;
              if (checkBtn) checkBtn.style.display = 'none';
              if (typeof item.id === 'string' && item.id.startsWith('mail-')) {
                await window.electronAPI.setEmailTodoFlag(item.id.replace('mail-', ''), 1);
              } else {
                if (window.electronAPI.setTodoComplete) {
                  await window.electronAPI.setTodoComplete(item.id, 1);
                }
              }
            } else {
              // 취소선 표시: 완료로 변경 (todo_flag=2)
              taskSpan.style.textDecoration = 'line-through';
              taskSpan.style.color = '#aaa';
              isNowCompleted = true;
              if (checkBtn) checkBtn.style.display = 'inline-block';
              if (typeof item.id === 'string' && item.id.startsWith('mail-')) {
                await window.electronAPI.setEmailTodoComplete(item.id.replace('mail-', ''));
              } else {
                if (window.electronAPI.setTodoComplete) {
                  await window.electronAPI.setTodoComplete(item.id, 2);
                }
              }
            }
          });
          // 체크 뱃지 클릭 시 DB에서 삭제 및 목록 새로고침
        const checkBtn = li.querySelector('.complete-check-btn');
        if (checkBtn) {
          checkBtn.addEventListener('click', async (e) => {
            if (typeof item.id === 'string' && item.id.startsWith('mail-')) {
              await window.electronAPI.setEmailTodoFlag(item.id.replace('mail-', ''), 0);
            } else {
              if (window.electronAPI.excludeTodo) {
                await window.electronAPI.excludeTodo(item.id);
              }
            }
            const todos = await fetchTodos();
            renderList(todos);
            if (window.electronAPI.openEmails) {
              window.electronAPI.openEmails();
            }
            e.stopPropagation();
          });
        }
        // 뱃지 숫자 갱신 (완료시 -1, 취소시 +1)
        const badge = document.getElementById('todo-count-badge');
        if (badge) {
          let current = parseInt(badge.textContent, 10) || 0;
          if (isNowCompleted && current > 0) badge.textContent = current - 1;
          if (!isNowCompleted) badge.textContent = current + 1;
        }
    const editBtn = li.querySelector('.memo-edit-btn');
    const excludeBtn = li.querySelector('.exclude-btn');
    const textarea = li.querySelector('.memo');
    editBtn.addEventListener('click', () => {
      if (textarea.style.display === 'none') {
        textarea.style.display = 'block';
        textarea.focus();
      } else {
        textarea.style.display = 'none';
      }
    });
    textarea.addEventListener('input', (e) => {
      window.electronAPI.saveMemo(item.id, e.target.value);
    });
    // 제외 버튼 클릭 시 확인창 후 제외 처리
    excludeBtn.addEventListener('click', async () => {
      const confirmed = await showCustomConfirm('할일 목록에서 제외하시겠습니까?');
      if (confirmed) {
        if (typeof item.id === 'string' && item.id.startsWith('mail-')) {
          await window.electronAPI.setEmailTodoFlag(item.id.replace('mail-', ''), 0);
        } else {
          await window.electronAPI.excludeTodo(item.id);
        }
        // 제외 후 목록 새로고침
        const todos = await fetchTodos();
        renderList(todos);
        // 메일 목록도 새로고침 (openEmails은 emails.html 창을 포커싱/오픈)
        if (window.electronAPI.openEmails) {
          window.electronAPI.openEmails();
        }
      }
    });
    // assets/icon.png 이미지를 사용하는 커스텀 confirm 모달 함수
    function showCustomConfirm(message) {
      return new Promise((resolve) => {
        // 기존 모달이 있으면 제거
        const oldModal = document.getElementById('custom-confirm-modal');
        if (oldModal) oldModal.remove();
        const modal = document.createElement('div');
        modal.id = 'custom-confirm-modal';
        modal.style.position = 'fixed';
        modal.style.top = '0';
        modal.style.left = '0';
        modal.style.width = '100vw';
        modal.style.height = '100vh';
        modal.style.background = 'rgba(0,0,0,0.25)';
        modal.style.display = 'flex';
        modal.style.alignItems = 'center';
        modal.style.justifyContent = 'center';
        modal.style.zIndex = '9999';
        modal.innerHTML = `
          <div style="background:#fff;padding:32px 36px;border-radius:14px;min-width:280px;max-width:90vw;box-shadow:0 4px 24px #00b49c22;display:flex;flex-direction:column;align-items:center;gap:18px;">
            <img src="assets/icon.png" alt="icon" style="width:48px;height:48px;margin-bottom:8px;" />
            <div style="font-size:1.1em;color:#222;text-align:center;margin-bottom:12px;">${message}</div>
            <div style="display:flex;gap:18px;justify-content:center;">
              <button id="custom-confirm-ok" style="background:#00b49f;color:#fff;border:none;padding:8px 24px;border-radius:6px;font-weight:bold;font-size:1em;cursor:pointer;">확인</button>
              <button id="custom-confirm-cancel" style="background:#eee;color:#333;border:none;padding:8px 24px;border-radius:6px;font-weight:bold;font-size:1em;cursor:pointer;">취소</button>
            </div>
          </div>
        `;
        document.body.appendChild(modal);
        document.getElementById('custom-confirm-ok').onclick = () => {
          modal.remove();
          resolve(true);
        };
        document.getElementById('custom-confirm-cancel').onclick = () => {
          modal.remove();
          resolve(false);
        };
        modal.addEventListener('click', (e) => {
          if (e.target === modal) {
            modal.remove();
            resolve(false);
          }
        });
      });
    }
    // (불필요한 list.appendChild(li); 및 닫는 괄호 제거)
}

document.addEventListener('DOMContentLoaded', async () => {
  const todos = await fetchTodos();
  renderList(todos);
  // 앱 시작 시 메일 설정이 있으면 자동 연동
  const settings = await window.electronAPI.getMailSettings();
    if (settings && settings.mail_id && settings.mail_pw && settings.protocol && settings.mail_type) {
      const todoMails = await fetchTodoMails();
      renderTodoMailCard(todoMails);

      // 새 할일 추가 신호 수신 시 즉시 갱신
      if (window.electronAPI.onNewTodoAdded) {
        window.electronAPI.onNewTodoAdded(async () => {
          console.log('[자동갱신] new-todo-added 이벤트 수신!');
          const mails = await fetchTodoMails();
          renderTodoMailCard(mails);
          if (typeof fetchTodos === 'function' && typeof renderList === 'function') {
            const todos = await fetchTodos();
            renderList(todos);
          }
          // 알림(토스트) 표시 (선택)
          if (window.Toastify) {
            Toastify({ text: '새 할일이 추가되었습니다!', duration: 2500, gravity: 'top', position: 'center', backgroundColor: '#00b49a' }).showToast();
          }
        });
      }
    let mailSince = settings.mailSince || settings.mail_since;
    if (mailSince === '') mailSince = undefined;
    if (!mailSince) {
      const emails = await window.electronAPI.getEmails();
      mailSince = emails && emails.length > 0 ? emails.reduce((a, b) => a.created_at > b.created_at ? a : b).created_at : undefined;
    }
    const info = {
      mailType: settings.mail_type,
      protocol: settings.protocol,
      mailId: settings.mail_id,
      mailPw: settings.mail_pw,
      mailSince,
      mailServer: settings.mail_server 
    };
    await window.electronAPI.mailConnect(info);
  }
});

// 연동하기 버튼(이메일 연동) 클릭 시 새 메일만 동기화
// settings-btn이 연동 버튼임을 가정
const syncBtn = document.querySelector('.settings-btn');
    syncBtn.addEventListener('click', async () => {
      // 메일 설정 가져오기
      const settings = await window.electronAPI.getMailSettings();
      if (!settings) {
        window.electronAPI.openSettings();
        return;
      }
      // DB에서 가장 최근 메일 날짜 조회
      let mailSince = settings.mailSince;
      mailSince = settings.mailSince || settings.mail_since;
      if (mailSince === '') mailSince = undefined;
      if (!mailSince) {
        const emails = await window.electronAPI.getEmails();
        mailSince = emails && emails.length > 0 ? emails.reduce((a, b) => a.created_at > b.created_at ? a : b).created_at : undefined;
      }
      const info = {
        mailType: settings.mail_type,
        protocol: settings.protocol,
        mailId: settings.mail_id,
        mailPw: settings.mail_pw,
        mailSince,
        mailServer: settings.mail_server || ''
      };
      // 메일 연동(최신 메일 이후만)
      const result = await window.electronAPI.mailConnect(info);
      // 연동 성공 시 자동 저장
      if (result && result.success) {
        await window.electronAPI.saveMailSettings({
          mailType: info.mailType,
          protocol: info.protocol,
          mailId: info.mailId,
          mailPw: info.mailPw,
          mailSince: info.mailSince,
          mailServer: settings.mail_server || ''
        });
      }
      // 동기화 후 목록 새로고침
      const todos = await fetchTodos();
      renderList(todos);
    });

// 1분마다 실시간으로 todo 목록 새로고침
setInterval(async () => {
  const todos = await fetchTodos();
  renderList(todos);
}, 60 * 1000);

// 새로고침/전체삭제 버튼 추가 및 동작 구현
const headerRight = document.querySelector('.header-right');
const refreshBtn = document.createElement('button');
refreshBtn.className = 'refresh-btn';
refreshBtn.title = '새로고침';
refreshBtn.style.marginRight = '8px';
refreshBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M17.65 6.35A8 8 0 1 0 20 12" stroke="#00b48a" stroke-width="2" fill="none" stroke-linecap="round"/><polyline points="20,4 20,8 16,8" stroke="#00b48a" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
//headerRight.insertBefore(refreshBtn, headerRight.firstChild);
refreshBtn.addEventListener('click', async () => {
  // 이메일 todo를 todos에 반영
  if (window.electronAPI.refreshTodosFromEmails) {
    await window.electronAPI.refreshTodosFromEmails();
  }
  const todos = await fetchTodos();
  renderList(todos);
});

const deleteAllBtn = document.createElement('button');
deleteAllBtn.className = 'delete-all-btn';
deleteAllBtn.title = '전체 할일 삭제';
deleteAllBtn.style.marginRight = '8px';
deleteAllBtn.style.background = 'none';
deleteAllBtn.style.border = 'none';
deleteAllBtn.style.boxShadow = 'none';
deleteAllBtn.style.padding = '0';
deleteAllBtn.style.outline = 'none';
deleteAllBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="rgba(9, 100, 77, 1)" stroke-width="2"/><path d="M8 12h8" stroke="rgba(6, 145, 115, 1)" stroke-width="2"/></svg>`;
headerRight.insertBefore(deleteAllBtn, headerRight.firstChild);
deleteAllBtn.addEventListener('click', async () => {
  if (confirm('정말 전체 할일을 삭제하시겠습니까?')) {
    await window.electronAPI.deleteAllTodos();
    const todos = await fetchTodos();
    renderList(todos);
  }
});
