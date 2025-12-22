/**
 * 1. 상태 관리 변수
 */
let isRefreshing = false; // 중복 실행 방지

/**
 * 2. 데이터 가져오기 함수
 */
async function fetchTodos() {
    return await window.electronAPI.getTodos();
}

async function fetchCompletedTodos() {
    const todos = await window.electronAPI.getTodos();
    return Array.isArray(todos) ? todos.filter(todo => todo.todo_flag === 2) : [];
}

/**
 * 3. 렌더링 함수 (renderList)
 */
function renderList(todos) {
    const list = document.querySelector('.schedule-list');
    if (!list) return;

    // 헤더 뱃지 갱신
    const badge = document.getElementById('todo-count-badge');
    if (badge) {
        const notCompleted = Array.isArray(todos) ? todos.filter(t => t.todo_flag !== 2) : [];
        badge.textContent = notCompleted.length;
    }

    const filteredTodos = Array.isArray(todos) ? todos.filter(t => t.todo_flag !== 2) : [];
    list.innerHTML = '';

    if (filteredTodos.length === 0) {
        list.innerHTML = '<li style="color:#888; text-align:center; padding: 20px;">할일이 없습니다.</li>';
        return;
    }

    // 정렬 로직 (이메일 우선 -> 일반 데드라인 순)
    const sortedTodos = [...filteredTodos].sort((a, b) => {
        const isMailA = typeof a.id === 'string' && a.id.startsWith('mail-');
        const isMailB = typeof b.id === 'string' && b.id.startsWith('mail-');
        if (isMailA && isMailB) return new Date(b.received_at || 0) - new Date(a.received_at || 0);
        if (!isMailA && !isMailB) {
            if (!a.deadline || a.deadline === '없음') return 1;
            if (!b.deadline || b.deadline === '없음') return -1;
            return new Date(a.deadline) - new Date(b.deadline);
        }
        return isMailA ? -1 : 1;
    });

    sortedTodos.forEach((item) => {
        const li = document.createElement('li');
        li.setAttribute('draggable', 'true');
        
        const memo = item.memo || '';
        let isUrgent = false;
        let deadlineHtml = '';

        if (item.deadline && item.deadline !== '없음' && item.deadline !== item.date) {
            deadlineHtml = `<span class="deadline" style="color:#00b49cff;font-weight:bold;margin-right:6px;">마감: ${item.deadline}</span>`;
            const today = new Date(); today.setHours(0,0,0,0);
            const dlDate = new Date(item.deadline); dlDate.setHours(0,0,0,0);
            if (dlDate <= today) isUrgent = true;
        } else {
            deadlineHtml = `<span class="deadline" style="color:#888;font-weight:bold;margin-right:6px;">마감: 없음</span>
                            <input type="date" class="set-deadline-input" style="margin-left:4px;" />
                            <button class="set-deadline-btn">저장</button>`;
        }

        const isCompleted = item.todo_flag === 2;
        li.innerHTML = `
            ${deadlineHtml}
            <span class="date">${item.date || ''} </span>
            <span class="d-day">${item.dday || ''}</span>
            <span class="task" style="${isCompleted ? 'text-decoration:line-through;color:#aaa;' : ''}">${item.task}</span>
            <button class="memo-edit-btn" title="메모">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="3" fill="#7affcaff" stroke="#00b49cff" stroke-width="1.5"/><path d="M16 21v-4a1 1 0 0 1 1-1h4" stroke="#00b478ff" fill="#fff"/></svg>
            </button>
            <button class="exclude-btn" title="제외">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="16" rx="3" fill="#e0e0e0" stroke="#888" stroke-width="1.5"/><path d="M8 12h8" stroke="#888" stroke-width="2"/></svg>
            </button>
            <textarea class="memo" style="display:none;">${memo}</textarea>
            <button class="complete-check-btn" style="display:${isCompleted ? 'inline-block' : 'none'};">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" fill="#00b49cff"/><path d="M8 12l3 3 5-5" stroke="#fff" stroke-width="2" fill="none"/></svg>
            </button>
        `;

        // --- 내부 이벤트 바인딩 ---
        // 마감일 저장
        const saveDlBtn = li.querySelector('.set-deadline-btn');
        if (saveDlBtn) {
            saveDlBtn.onclick = async (e) => {
                e.stopPropagation();
                const dateVal = li.querySelector('.set-deadline-input').value;
                if (!dateVal) return;
                if (typeof item.id === 'string' && item.id.startsWith('mail-')) {
                    await window.electronAPI.setEmailDeadline(item.id.replace('mail-', ''), dateVal);
                } else {
                    await window.electronAPI.setTodoDeadline(item.id, dateVal);
                }
                refreshDisplay();
            };
        }

        // 완료 토글 (글자 클릭)
        li.querySelector('.task').onclick = async () => {
            const currentFlag = item.todo_flag === 2 ? 1 : 2;
            if (typeof item.id === 'string' && item.id.startsWith('mail-')) {
                await window.electronAPI.setEmailTodoFlag(item.id.replace('mail-', ''), currentFlag);
            } else {
                await window.electronAPI.setTodoComplete(item.id, currentFlag);
            }
            refreshDisplay();
        };

        // 메모 필드 토글 및 자동 저장
        const memoArea = li.querySelector('.memo');
        li.querySelector('.memo-edit-btn').onclick = (e) => {
            e.stopPropagation();
            memoArea.style.display = memoArea.style.display === 'none' ? 'block' : 'none';
        };
        memoArea.oninput = (e) => window.electronAPI.saveMemo(item.id, e.target.value);

        // 제외 버튼
        li.querySelector('.exclude-btn').onclick = async (e) => {
            e.stopPropagation();
            if (confirm('할일 목록에서 제외하시겠습니까?')) {
                if (typeof item.id === 'string' && item.id.startsWith('mail-')) {
                    await window.electronAPI.setEmailTodoFlag(item.id.replace('mail-', ''), 0);
                } else {
                    await window.electronAPI.excludeTodo(item.id);
                }
                refreshDisplay();
            }
        };

        if (isUrgent) li.classList.add('urgent-blink');
        list.appendChild(li);
    });
}

/**
 * 4. 전역 갱신 함수 (refreshDisplay)
 */
async function refreshDisplay() {
    if (isRefreshing) return;
    isRefreshing = true;

    try {
        console.log('[%s] 데이터 로드 시작...', new Date().toLocaleTimeString());
        const todos = await window.electronAPI.getTodos();
        console.log('수신 데이터:', todos);
        
        if (Array.isArray(todos)) {
            renderList(todos);
        }
    } catch (err) {
        console.error('갱신 실패:', err);
    } finally {
        isRefreshing = false;
    }
}

/**
 * 5. 앱 초기화 (이벤트 리스너 통합)
 */
document.addEventListener('DOMContentLoaded', () => {
    // A. 초기 즉시 실행 및 주기적 타이머(1분)
    refreshDisplay();
    setInterval(refreshDisplay, 60000);

    // B. 설정(톱니바퀴) 아이콘
    const cogBtn = document.querySelector('.cog-btn');
    if (cogBtn) cogBtn.onclick = () => window.electronAPI.openAppSettings();

    // C. 할일 추가 모달
    const fab = document.getElementById('add-todo-fab');
    const modal = document.getElementById('add-todo-modal');
    const taskInput = document.getElementById('add-todo-task');
    const deadlineInput = document.getElementById('add-todo-deadline');

    if (fab) {
        fab.onclick = () => {
            modal.style.display = 'flex';
            taskInput.value = '';
            deadlineInput.value = '';
            setTimeout(() => taskInput.focus(), 100);
        };
    }
    const saveTodoBtn = document.getElementById('save-add-todo');
    if (saveTodoBtn) {
        saveTodoBtn.onclick = async () => {
            const task = taskInput.value.trim();
            if (!task) return;
            await window.electronAPI.insertTodo({ task, deadline: deadlineInput.value });
            modal.style.display = 'none';
            refreshDisplay();
        };
    }

    // D. 완료된 목록 보기
    const completedBtn = document.querySelector('.completed-btn');
    const completedModal = document.getElementById('completed-modal');
    if (completedBtn) {
        completedBtn.onclick = async () => {
            const completed = await fetchCompletedTodos();
            const list = document.getElementById('completed-list');
            list.innerHTML = completed.map(t => `
                <li style="margin-bottom:8px;">
                    <span style="text-decoration:line-through;color:#aaa;">${t.task}</span> 
                    <span style="color:#b48a00;">${t.deadline ? '('+t.deadline+')' : ''}</span>
                </li>
            `).join('') || '<li style="color:#888;">완료된 할일이 없습니다.</li>';
            completedModal.style.display = 'flex';
        };
    }

    // E. 이메일 동기화 (연동하기) 버튼
    const syncBtn = document.querySelector('.settings-btn');
    if (syncBtn) {
        syncBtn.onclick = async () => {
            const settings = await window.electronAPI.getMailSettings();
            if (!settings) { window.electronAPI.openAppSettings(); return; }
            
            const result = await window.electronAPI.mailConnect(settings);
            if (result && result.success) {
                console.log('메일 동기화 성공');
                refreshDisplay();
            }
        };
    }

    // F. 전체 삭제 버튼 생성 및 삽입
    const headerRight = document.querySelector('.header-right');
    if (headerRight) {
        const delAllBtn = document.createElement('button');
        delAllBtn.innerHTML = '전체삭제';
        delAllBtn.className = 'delete-all-btn';
        // 중복 방지를 위해 기존 버튼 삭제 후 삽입
        const existingDel = headerRight.querySelector('.delete-all-btn');
        if (existingDel) existingDel.remove();
        
        headerRight.prepend(delAllBtn);
        delAllBtn.onclick = async () => {
            if (confirm('정말 전체 할일을 삭제하시겠습니까?')) {
                await window.electronAPI.deleteAllTodos();
                refreshDisplay();
            }
        };
    }

    // G. 메인 프로세스 실시간 신호 감지
    if (window.electronAPI.onNewTodoAdded) {
        window.electronAPI.onNewTodoAdded(() => {
            console.log('실시간 신호 수신됨');
            refreshDisplay();
        });
    }
});