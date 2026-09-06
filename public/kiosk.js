// ================= 自助取号机 · 签到/取号逻辑 =================

const API = '/api';

let currentBooking = null; // 当前正在处理的记录
let checkinStepStack = [];  // 用于"重新输入"回退

function getAuthToken() {
    return localStorage.getItem('dhd_kiosk_token') || '';
}

// ---------- 页面切换 ----------
function goScreen(name) {
    // 非签到页时重置签到状态
    if (name !== 'checkin') resetCheckinInternal();
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById('screen-' + name);
    if (el) el.classList.add('active');
}

// 签到流程内部切换（显示某个 step）
function goStep(stepId) {
    document.querySelectorAll('.checkin-step').forEach(s => s.classList.remove('active'));
    const el = document.getElementById('step-' + stepId);
    if (el) el.classList.add('active');
}

function resetCheckin() {
    resetCheckinInternal();
    goStep('number');
    currentBooking = null;
}

function resetCheckinInternal() {
    // 清理输入并回到首页逻辑相关状态
    const num = document.getElementById('checkin-number');
    const phone = document.getElementById('checkin-phone');
    if (num) num.value = '';
    if (phone) phone.value = '';
}

// ---------- 数字键盘 ----------
function buildKeypad(containerId, targetInputId) {
    const pad = document.getElementById(containerId);
    if (!pad || pad.dataset.built) return;
    pad.dataset.built = '1';
    const keys = ['1','2','3','4','5','6','7','8','9','清空','0','⌫'];
    keys.forEach(k => {
        const btn = document.createElement('button');
        btn.className = 'pad-key';
        btn.textContent = k;
        btn.onclick = () => {
            const input = document.getElementById(targetInputId);
            if (k === '清空') { input.value = ''; return; }
            if (k === '⌫') { input.value = input.value.slice(0, -1); return; }
            input.value = (input.value + k).slice(0, 4);
        };
        pad.appendChild(btn);
    });
}

// 监听实体键盘（可选）
function attachInputListener() {
    const num = document.getElementById('checkin-number');
    num.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') checkinLookup();
    });
    const phone = document.getElementById('checkin-phone');
    phone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') checkinVerify();
    });
}

// ---------- 通用请求 ----------
async function api(path, options = {}) {
    try {
        const res = await fetch(API + path, {
            headers: { 'Content-Type': 'application/json' },
            ...options
        });
        const data = await res.json().catch(() => ({}));
        return { ok: res.ok, status: res.status, ...data };
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

function setBtnColor() {
    const el = document.getElementById('toast');
    el.className = 'toast show';
}

// ---------- 步骤1：输入号码牌后查找 ----------
async function checkinLookup() {
    const number = document.getElementById('checkin-number').value.trim();
    if (!/^\d{3,4}$/.test(number)) {
        showToast('请输入3-4位号码牌', 'error');
        return;
    }
    const res = await api('/checkin/lookup?number=' + encodeURIComponent(number));
    if (!res.ok) { showToast(res.error || '查询失败', 'error'); return; }

    if (!res.found) {
        // 未找到 → 步骤2：确认
        document.getElementById('nf-number').textContent = number;
        goStep('notfound');
        return;
    }
    currentBooking = res.booking;
    if (res.checked) {
        document.getElementById('ad-number').textContent = res.booking.number;
        goStep('alreadydone');
        return;
    }
    // 核对成功 → 步骤3：输手机尾号
    goStep('phone');
}

// ---------- 步骤2：核对失败确认 ----------
function checkinNotFoundYes() {
    // 用户确认是 → 前往服务台
    goStep('desk');
}
function checkinRetry() {
    currentBooking = null;
    goStep('number');
    document.getElementById('checkin-number').value = '';
}

// ---------- 步骤3：手机尾号核验 ----------
function checkinVerify() {
    if (!currentBooking) { goStep('number'); return; }
    const phone = document.getElementById('checkin-phone').value.trim();
    if (!/^\d{4}$/.test(phone)) {
        showToast('请输入4位手机尾号', 'error');
        return;
    }
    // 先展示确认步骤，二次校验交由 verify 弹出
    api('/checkin/verify', {
        method: 'POST',
        body: JSON.stringify({ id: currentBooking.id, phoneTail: phone })
    }).then(async (res) => {
        if (!res.ok) { showToast(res.error || '核验失败', 'error'); return; }
        if (!res.verified) {
            // 手机尾号不匹配 → 步骤4
            document.getElementById('checkin-phone').value = '';
            goStep('phonefail');
            return;
        }
        currentBooking.phoneTail = phone; // 保留用户输入
        // 填充确认信息
        document.getElementById('tp-number').textContent = currentBooking.number;
        document.getElementById('tp-phone').textContent = '****' + currentBooking.phoneTail;
        document.getElementById('tp-people').textContent = (currentBooking.people || 1) + ' 人 · 儿童 ' + (currentBooking.children || 0) + ' 人';
        document.getElementById('tp-date').textContent = formatDate(currentBooking.date);
        goStep('confirm');
    });
}

// 步骤4：手机失败重新输入
function checkinRetryPhone() {
    goStep('phone');
    document.getElementById('checkin-phone').value = '';
    const padPhone = document.getElementById('num-pad-phone');
    if (padPhone) padPhone.dataset.built = ''; // 允许重新构建（无实际影响）
}

// ---------- 步骤5：确认签到 ----------
async function checkinConfirm() {
    if (!currentBooking) { goStep('number'); return; }
    const res = await api('/checkin/confirm', {
        method: 'POST',
        body: JSON.stringify({ id: currentBooking.id })
    });
    if (!res.ok) { showToast(res.error || '签到失败', 'error'); return; }
    document.getElementById('done-number').textContent = currentBooking.number;
    goStep('done');
}
function formatDate(dateStr) {
    const d = new Date(dateStr);
    const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${weekDays[d.getDay()]}`;
}

// ================= 现场取号（直接排队等叫号，无需签到） =================
function stepper(peopleId, childrenId, delta, which) {
    const p = document.getElementById(peopleId);
    const c = document.getElementById(childrenId);
    if (which === 'children') {
        const v = parseInt(c.value, 10) + delta;
        if (v < 0 || v > 50) return;
        if (v > parseInt(p.value, 10)) { showToast('儿童人数不能超过总人数', 'error'); return; }
        c.value = Math.max(0, parseInt(p.value, 10) > 0 ? v : 0);
    } else {
        const v = parseInt(p.value, 10) + delta;
        if (v < 1 || v > 50) return;
        p.value = v;
        if (parseInt(c.value, 10) > v) c.value = v;
    }
}

async function submitKioskTake() {
    const phoneTail = document.getElementById('take-phone').value.trim();
    if (phoneTail && !/^\d{4}$/.test(phoneTail)) {
        showToast('手机尾号需为4位数字（可留空）', 'error');
        return;
    }
    const people = parseInt(document.getElementById('take-people').value, 10);
    const children = parseInt(document.getElementById('take-children').value, 10);
    if (children > people) { showToast('儿童人数不能超过总人数', 'error'); return; }

    const btn = document.querySelector('#take-form .btn-primary');
    if (btn) btn.disabled = true;

    const res = await api('/kiosk/take', {
        method: 'POST',
        body: JSON.stringify({ phoneTail, people, children })
    });
    if (btn) btn.disabled = false;
    if (!res.ok) { showToast(res.error || '取号失败，请重试', 'error'); return; }

    // 显示号码牌
    const b = res.booking;
    document.getElementById('tk-number').textContent = b.number;
    document.getElementById('tk-phone').textContent = b.phoneTail ? ('****' + b.phoneTail) : '—';
    document.getElementById('tk-people').textContent = b.people + ' 人 · 儿童 ' + b.children + ' 人';
    document.getElementById('tk-date').textContent = formatDate(b.date);
    document.getElementById('take-form').style.display = 'none';
    const result = document.getElementById('take-result');
    result.style.display = 'block';
    result.scrollIntoView({ behavior: 'smooth' });
    document.getElementById('take-phone').value = '';
}

function resetTake() {
    document.getElementById('take-result').style.display = 'none';
    document.getElementById('take-form').style.display = 'block';
    document.getElementById('take-people').value = '1';
    document.getElementById('take-children').value = '0';
    document.getElementById('take-phone').value = '';
}

// ================= 初始化 =================
document.addEventListener('DOMContentLoaded', () => {
    buildKeypad('num-pad', 'checkin-number');
    buildKeypad('num-pad-phone', 'checkin-phone');
    buildKeypad('num-pad-take', 'take-phone');
    attachInputListener();
    goStep('number');

    // 连接 Socket.IO，接收实时更新（后续叫号用）
    if (typeof io !== 'undefined') {
        const socket = io();
        socket.on('stats', () => { /* 预留 */ });
        socket.on('called', (data) => {
            if (data && data.number) {
                showToast(`请 ${data.number} 号前往 ${data.window || '服务台'}`, 'success');
            }
        });
    }
});