// ================= 到店确认台 =================
const API = '/api';

let identified = null;      // 通过扫码/输入识别出的票（publicTicket）
let arriveProof = null;     // arrive 需要的凭证 { id, token }，扫码才有 token
let manualNumber = '';

const TYPE_TEXT = {
    'time-booking': '时间预约',
    'online-queue': '线上取号',
    'kiosk': '现场取号'
};
const STATUS_TEXT = {
    called: '🔊 叫号中，请确认到店',
    arrived: '📍 已确认到店',
    seated: '🍽️ 就餐中',
    done: '✅ 已就餐完成',
    passed: '↩️ 已过号',
    waiting: '⏳ 还未被叫到',
    checked: '⏳ 还未被叫到',
    cancelled: '✖️ 已取消',
    expired: '⏰ 已失效'
};

// ---------- 请求 ----------
async function api(path, options = {}) {
    try {
        const body = options.body && typeof options.body !== 'string'
            ? JSON.stringify(options.body) : options.body;
        const res = await fetch(API + path, {
            headers: { 'Content-Type': 'application/json' },
            ...options,
            body
        });
        const data = await res.json().catch(() => ({}));
        return { ok: res.ok, status: res.status, ...data };
    } catch (e) {
        return { ok: false, error: '无法连接服务器，请确认后端已启动' };
    }
}
function showToast(msg, type = 'info') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'cf-toast ' + type + ' show';
    setTimeout(() => { t.className = 'cf-toast ' + type; }, 2200);
}

// ---------- 面板切换 ----------
function showPane(name) {
    document.querySelectorAll('.pane').forEach(p => p.classList.remove('active'));
    const el = document.getElementById('pane-' + name);
    if (el) el.classList.add('active');
    if (name === 'idle') { stopCamera(); resetManual(); }
}
const goIdle = () => showPane('idle');

// ---------- 当前叫号（Socket 实时） ----------
function renderCalled(records) {
    const list = document.getElementById('called-list');
    const called = (records || []).filter(b => b.status === 'called');
    if (!called.length) {
        list.innerHTML = '<div class="called-empty">暂时没有叫号，请稍候…</div>';
        return;
    }
    list.innerHTML = '';
    called.forEach(b => {
        const card = document.createElement('div');
        card.className = 'called-card';
        card.innerHTML = `
            <div class="cc-number">${b.number}</div>
            <div class="cc-meta">${b.tableNo ? ('🪑 ' + b.tableNo) : '请到服务台'}</div>
        `;
        list.appendChild(card);
    });
}
// ---------- 连接状态检测 ----------
let socketInstance = null;
let isOnline = true;
let pingTimer = null;

function setOnline(online) {
    if (online === isOnline) return;
    isOnline = online;
    const ov = document.getElementById('offline-overlay');
    if (!ov) return;
    ov.style.display = online ? 'none' : 'flex';
    if (!online) {
        // 断开时停止摄像头，避免资源占用
        stopCamera();
    }
}
window.setOnline = setOnline; // 暴露给外部调试用

async function checkPing() {
    try {
        const r = await fetch(API + '/stats', { method: 'GET', cache: 'no-store' });
        setOnline(r.ok);
    } catch (e) {
        setOnline(false);
    }
}

function connectSocket() {
    if (typeof io === 'undefined') {
        // 没有 socket.io 库，靠定期 ping 兜底
        startPingLoop();
        return;
    }
    const socket = io({ reconnectionDelay: 1500, reconnectionDelayMax: 5000 });
    socketInstance = socket;

    socket.on('connect', () => {
        setOnline(true);
    });
    socket.on('disconnect', () => {
        setOnline(false);
    });
    socket.on('connect_error', () => {
        setOnline(false);
    });
    socket.on('queue', (data) => renderCalled(data && data.called));
    socket.on('called', (data) => renderCalled(data && data.called));

    // 额外兜底：每 5 秒 fetch 一次，防止 socket 状态与实际不一致
    startPingLoop();
}

function startPingLoop() {
    if (pingTimer) return;
    pingTimer = setInterval(checkPing, 5000);
    checkPing(); // 立即检测一次
}

// 页面首次加载先检测连接
checkPing();

// ---------- 扫码 ----------
let _stream = null;
let _raf = null;
let _lock = false;
function openScan() {
    showPane('scan');
    document.getElementById('cam-status').textContent = '正在启动摄像头…';
    document.getElementById('cam-error').style.display = 'none';
    startCamera();
}
async function startCamera() {
    const video = document.getElementById('scan-video');
    if (!video || !window.jsQR) { failCamera(); return; }
    stopCamera();
    _lock = false;
    // 电脑上通常没有后置摄像头，依次回退：environment → user → 默认
    const constraints = [
        { video: { facingMode: { exact: 'environment' } } },
        { video: { facingMode: 'environment' } },
        { video: { facingMode: { exact: 'user' } } },
        { video: { facingMode: 'user' } },
        { video: true }
    ];
    for (const c of constraints) {
        try {
            _stream = await navigator.mediaDevices.getUserMedia(c);
            video.srcObject = _stream;
            await video.play();
            document.getElementById('cam-status').textContent = '📷 请把手机上的「到店码」对准镜头';
            tickScan();
            return;
        } catch (e) {}
    }
    failCamera();
}
function failCamera() {
    document.getElementById('cam-status').textContent = '';
    document.getElementById('cam-error').style.display = 'block';
}
function stopCamera() {
    if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
    if (_stream) { _stream.getTracks().forEach(t => t.stop()); _stream = null; }
    const video = document.getElementById('scan-video');
    if (video) video.srcObject = null;
}
function tickScan() {
    const video = document.getElementById('scan-video');
    const cvs = document.getElementById('scan-canvas');
    if (!video || video.readyState < 2 || video.videoWidth === 0) {
        _raf = requestAnimationFrame(tickScan);
        return;
    }
    const w = video.videoWidth, h = video.videoHeight;
    cvs.width = w; cvs.height = h;
    const ctx = cvs.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    const code = window.jsQR(img.data, w, h);
    if (code && code.data && !_lock) {
        _lock = true;
        stopCamera();
        handlePayload(code.data);
        return;
    }
    _raf = requestAnimationFrame(tickScan);
}
async function handlePayload(payload) {
    const m = /^DHD:(\d+):([0-9a-f]{16})$/.exec(String(payload || '').trim());
    if (!m) { showPanes('result', '❌', '无效的到店码', '请出示预约平台保存的到店码'); return; }
    const id = parseInt(m[1], 10), token = m[2];
    const res = await api('/confirm/resolve', { method: 'POST', body: { payload } });
    arriveProof = { id, token };
    if (!res.ok || !res.booking) { showPanes('result', '❌', '到店码无效', '请重新让顾客扫码'); return; }
    showTicket(res.booking);
}

// ---------- 初始化 ----------
document.addEventListener('DOMContentLoaded', () => {
    renderCalled([]);
    connectSocket();
});

// ---------- 展示票 + 确认到店 ----------
function showTicket(b) {
    identified = b;
    document.getElementById('ticket-number').textContent = b.number;
    document.getElementById('ticket-type').textContent = TYPE_TEXT[b.type] || b.type;
    document.getElementById('ticket-people').textContent = (b.people || 1) + ' 人 · 儿童 ' + (b.children || 0) + ' 人';
    document.getElementById('ticket-table').textContent = b.tableNo ? '🪑 ' + b.tableNo : '—';
    const st = document.getElementById('ticket-status');
    st.textContent = STATUS_TEXT[b.status] || '未知状态';
    st.className = 'ticket-status ' + b.status;

    // 只有叫号中(called)才能确认到店
    const canConfirm = b.status === 'called';
    const btn = document.getElementById('confirm-arrive-btn');
    btn.style.display = canConfirm ? 'block' : 'none';
    if (!canConfirm) {
        document.getElementById('ticket-title').textContent = STATUS_TEXT[b.status] || '当前状态';
    } else {
        document.getElementById('ticket-title').textContent = '确认到店？';
    }
    showPane('ticket');
}
async function confirmArrive() {
    if (!identified || !arriveProof) return;
    const btn = document.getElementById('confirm-arrive-btn');
    btn.disabled = true;
    const res = await api('/confirm/arrive', {
        method: 'POST',
        body: { id: arriveProof.id, token: arriveProof.token || null }
    });
    btn.disabled = false;
    if (!res.ok) {
        showToast(res.error || '确认失败，请重试', 'error');
        // 状态可能已变化，刷新显示
        const chk = await api('/confirm/lookup', { method: 'POST', body: { number: identified.number } });
        if (chk.ok && chk.booking) showTicket(chk.booking);
        return;
    }
    showPanes('result', '✅', '已确认到店', `号码 ${identified.number} 已确认，请前往就餐区`);
}
function showPanes(name, icon, title, msg) {
    document.getElementById('result-icon').textContent = icon;
    document.getElementById('result-title').textContent = title;
    document.getElementById('result-msg').textContent = msg || '';
    identified = null;
    arriveProof = null;
    showPane(name);
}