// ================= 后台管理逻辑 =================

const API = '/api';
let queueData = [];
let settings = { tables: [], autoAssignTable: false };

async function api(path, options = {}) {
    try {
        let body = null;
        if (options.body && typeof options.body !== 'string') body = JSON.stringify(options.body);
        else body = options.body;
        const res = await fetch(API + path, {
            headers: { 'Content-Type': 'application/json' },
            ...options,
            body
        });
        const j = await res.json().catch(() => ({}));
        return { ok: res.ok, status: res.status, ...j };
    } catch (err) {
        return { ok: false, error: '无法连接服务器，请确认后端已启动' };
    }
}

function showToast(msg, type = 'info') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast ' + type + ' show';
    setTimeout(() => { t.className = 'toast ' + type; }, 2500);
}

// ---------- 状态文案与颜色 ----------
const STATUS_MAP = {
    waiting: { text: '等待中', cls: 'st-waiting' },
    checked: { text: '已签到', cls: 'st-checked' },
    called: { text: '🔊 叫号中', cls: 'st-called' },
    seated: { text: '🍽️ 就餐中', cls: 'st-seated' },
    done: { text: '✅ 已完成', cls: 'st-done' },
    passed: { text: '↩️ 已过号', cls: 'st-passed' },
    cancelled: { text: '✖️ 已取消', cls: 'st-cancelled' },
    expired: { text: '⏰ 已过期', cls: 'st-cancelled' }
};

// ---------- 加载队列 ----------
async function loadQueue() {
    const res = await api('/admin/queue');
    if (!res.ok) { showToast(res.error || '加载失败', 'error'); return; }
    queueData = res.queue || [];
    settings.tables = res.settings || settings.tables;
    renderQueue();
}

// ---------- 渲染队列 ----------
function renderQueue() {
    const listEl = document.getElementById('queue-list');
    const emptyEl = document.getElementById('queue-empty');
    const countEl = document.getElementById('queue-count');
    const active = queueData.filter(b => ['waiting','checked','called','seated'].includes(b.status));
    countEl.textContent = active.length + ' 位';

    if (queueData.length === 0) {
        listEl.innerHTML = '';
        emptyEl.style.display = 'block';
        document.getElementById('now-calling').style.background = '';
        document.getElementById('now-number').textContent = '—';
        document.getElementById('now-table').textContent = '';
        return;
    }
    emptyEl.style.display = 'none';

    const callings = queueData.filter(b => b.status === 'called');
    if (callings.length > 0) {
        const cur = callings[0];
        document.getElementById('now-number').textContent = cur.number;
        document.getElementById('now-table').textContent = cur.tableNo ? ('→ ' + cur.tableNo) : '';
        if (cur.tableNo) {
            document.getElementById('now-calling').style.background = 'linear-gradient(135deg,#ff9a56,#ff6a3d)';
        } else {
            document.getElementById('now-calling').style.background = 'linear-gradient(135deg,#667eea,#764ba2)';
        }
    } else {
        document.getElementById('now-number').textContent = '—';
        document.getElementById('now-table').textContent = '';
        document.getElementById('now-calling').style.background = '';
    }

    listEl.innerHTML = '';
    queueData.forEach(b => {
        const sm = STATUS_MAP[b.status] || STATUS_MAP.waiting;
        const card = document.createElement('div');
        card.className = 'queue-item ' + (b.status === 'called' ? 'called' : '');
        card.dataset.id = b.id;

        let actions = '';
        if (b.status === 'waiting' || b.status === 'checked' || b.status === 'passed') {
            actions += `<button class="op op-call" onclick="callOne(${b.id})">叫号</button>`;
            actions += `<button class="op op-pass" onclick="passOne(${b.id})">过号</button>`;
        }
        if (b.status === 'called') {
            actions += `<button class="op op-recall" onclick="recallOne(${b.id})">重呼</button>`;
            actions += `<button class="op op-seat" onclick="seatOne(${b.id})">入座</button>`;
        }
        if (b.status === 'waiting' || b.status === 'checked' || b.status === 'called') {
            actions += `<button class="op op-cancel" onclick="cancelOne(${b.id})">取消</button>`;
        }
        if (b.status === 'seated' || b.status === 'called') {
            actions += `<button class="op op-done" onclick="doneOne(${b.id})">完成</button>`;
        }

        card.innerHTML = `
            <div class="q-left">
                <div class="q-number ${b.number.length > 3 ? 'long' : ''}">${b.number}</div>
                <div class="q-meta">
                    <span class="q-type">${b.type === 'time-booking' ? '🕐时间预约' : b.type === 'online-queue' ? '🎫线上' : '🏢现场'}</span>
                    <span class="q-time">${formatTime(b.createdAt)}</span>
                </div>
            </div>
            <div class="q-info">
                <div class="q-people">${b.people}人 · 儿童${b.children}人</div>
                <div class="q-table">${b.tableNo ? ('🪑 ' + b.tableNo) : ''}</div>
            </div>
            <div class="q-status">
                <span class="status-tag ${sm.cls}">${sm.text}</span>
            </div>
            <div class="q-actions">${actions}</div>
        `;
        listEl.appendChild(card);
    });
}

function formatTime(ts) {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// ---------- 操作 ----------
async function autoCallNext() {
    const tableNo = document.getElementById('call-table-input').value.trim();
    const res = await api('/admin/call', { method: 'POST', body: { tableNo } });
    if (!res.ok) { showToast(res.error || '叫号失败', 'error'); return; }
    showToast(`已叫号 ${res.booking.number}${res.booking.tableNo ? ' → ' + res.booking.tableNo : ''}`, 'success');
    document.getElementById('call-table-input').value = '';
    loadQueue();
}
async function callOne(id) {
    const tableNo = document.getElementById('call-table-input').value.trim();
    const res = await api('/admin/call', { method: 'POST', body: { id, tableNo } });
    if (!res.ok) { showToast(res.error || '叫号失败', 'error'); return; }
    showToast(`已叫号 ${res.booking.number}${res.booking.tableNo ? ' → ' + res.booking.tableNo : ''}`, 'success');
    document.getElementById('call-table-input').value = '';
    loadQueue();
}
async function recallOne(id) {
    const res = await api('/admin/recall', { method: 'POST', body: { id } });
    if (!res.ok) { showToast(res.error || '重呼失败', 'error'); return; }
    showToast(`已重呼 ${res.booking.number}`, 'info');
    loadQueue();
}
async function seatOne(id) {
    if (!confirm('确认该号码已入座就餐？')) return;
    const res = await api('/admin/seat', { method: 'POST', body: { id } });
    if (!res.ok) { showToast(res.error || '操作失败', 'error'); return; }
    showToast(`${res.booking.number} 号已入座就餐`, 'success');
    loadQueue();
}
async function doneOne(id) {
    if (!confirm('确认该桌已吃完离店？')) return;
    const res = await api('/admin/done', { method: 'POST', body: { id } });
    if (!res.ok) { showToast(res.error || '操作失败', 'error'); return; }
    showToast(`${res.booking.number} 号已完结`, 'success');
    loadQueue();
}
async function passOne(id) {
    if (!confirm('确认该号码过号跳过？')) return;
    const res = await api('/admin/pass', { method: 'POST', body: { id } });
    if (!res.ok) { showToast(res.error || '操作失败', 'error'); return; }
    showToast(`${res.booking.number} 号已过号`, 'info');
    loadQueue();
}
async function cancelOne(id) {
    if (!confirm('确认取消该号码？')) return;
    const res = await api('/bookings/' + id + '/cancel', { method: 'POST' });
    if (!res.ok) { showToast(res.error || '取消失败', 'error'); return; }
    showToast('已取消', 'success');
    loadQueue();
}

// ---------- 桌号配置 ----------
async function loadSettings() {
    const res = await api('/admin/settings');
    if (!res.ok) return;
    settings = res;
    document.getElementById('tables-input').value = (settings.tables || []).join(',');
    document.getElementById('autoTable-check').checked = !!settings.autoAssignTable;
    let dl = document.getElementById('table-list');
    if (!dl) {
        dl = document.createElement('datalist');
        dl.id = 'table-list';
        document.body.appendChild(dl);
    }
    dl.innerHTML = (settings.tables || []).map(t => `<option value="${t}">`).join('');
}
async function saveSettings() {
    const raw = document.getElementById('tables-input').value;
    const tables = raw.split(/[,，]/).map(s => s.trim()).filter(Boolean);
    const auto = document.getElementById('autoTable-check').checked;
    const res = await api('/admin/settings', { method: 'POST', body: { tables, autoAssignTable: auto } });
    if (!res.ok) { showToast(res.error || '保存失败', 'error'); return; }
    settings = res;
    showToast('桌号配置已保存', 'success');
    loadSettings();
}

// ---------- 初始化 ----------
document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    loadQueue();
    if (typeof io !== 'undefined') {
        const socket = io();
        socket.on('queue', () => loadQueue());
    }
});