// ================= 预约平台（后端驱动版） =================
// 数据统一存后端数据库，跨端（预约平台/取号机/大屏/后台）共享。

const API = '/api';
const MAX_TIME_BOOKING = 9999;
const MAX_ONLINE_QUEUE = 999;
const START_HOUR = 12;
const END_HOUR = 24;

let selectedTimeSlot = null;
let currentUser = null;
let selectedBookingDate = null;

const SESSION_KEY = 'dhd_current_user';

// ---------- 工具 ----------
function formatDateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function getTodayDateString() { return formatDateKey(new Date()); }
function addDaysToDate(baseDate, days) {
    const d = new Date(baseDate);
    d.setDate(d.getDate() + days);
    return d;
}
function generateNext7Days() {
    const result = [];
    const today = new Date();
    const weekNames = ['日', '一', '二', '三', '四', '五', '六'];
    for (let i = 0; i < 7; i++) {
        const d = addDaysToDate(today, i);
        result.push({
            key: formatDateKey(d),
            label: i === 0 ? '今天' : (i === 1 ? '明天' : `周${weekNames[d.getDay()]}`),
            sub: `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`,
            day: i
        });
    }
    return result;
}

async function api(path, options = {}) {
    let body = null;
    if (options.body && typeof options.body !== 'string') {
        body = JSON.stringify(options.body);
    } else {
        body = options.body;
    }
    const res = await fetch(API + path, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
        body
    });
    const data = await res.json().catch(() => null);
    if (Array.isArray(data)) {
        return { ok: res.ok, status: res.status, list: data, length: data.length, ...data };
    }
    return { ok: res.ok, status: res.status, ...(data || {}) };
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    setTimeout(() => { toast.className = `toast ${type}`; }, 2500);
}

function formatDateDisplay(dateStr) {
    const d = dateStr ? new Date(dateStr) : new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return `${year}/${month}/${day} ${weekDays[d.getDay()]}`;
}

function validatePhoneTail(phoneTail) { return /^\d{4}$/.test(phoneTail); }

// ---------- 用户 ----------
function setCurrentUser(username) {
    currentUser = username;
    localStorage.setItem(SESSION_KEY, username);
    updateUserBar();
}
function clearCurrentUser() {
    currentUser = null;
    localStorage.removeItem(SESSION_KEY);
    updateUserBar();
}
function updateUserBar() {
    const userBar = document.getElementById('user-bar');
    const userNameEl = document.getElementById('current-user-name');
    if (currentUser) {
        userBar.style.display = 'flex';
        userNameEl.textContent = `👤 ${currentUser}`;
    } else {
        userBar.style.display = 'none';
    }
}
function restoreLogin() {
    const saved = localStorage.getItem(SESSION_KEY);
    if (saved) { currentUser = saved; updateUserBar(); return true; }
    return false;
}
function requireLogin() {
    if (!currentUser) { showToast('请先登录', 'error'); navigateTo('login'); return false; }
    return true;
}

async function doRegister() {
    const username = document.getElementById('register-username').value.trim();
    const password = document.getElementById('register-password').value;
    const password2 = document.getElementById('register-password2').value;

    if (!/^[a-zA-Z0-9]{3,20}$/.test(username)) { showToast('用户名需要3-20位字母或数字', 'error'); return; }
    if (password.length < 6) { showToast('密码至少6位字符', 'error'); return; }
    if (password !== password2) { showToast('两次密码不一致', 'error'); return; }

    const res = await api('/register', { method: 'POST', body: { username, password } });
    if (!res.ok) { showToast(res.error || '注册失败', 'error'); return; }
    showToast('注册成功，请登录', 'success');
    document.getElementById('register-username').value = '';
    document.getElementById('register-password').value = '';
    document.getElementById('register-password2').value = '';
    navigateTo('login');
}

async function doLogin() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    if (!username || !password) { showToast('请输入用户名和密码', 'error'); return; }

    const res = await api('/login', { method: 'POST', body: { username, password } });
    if (!res.ok) { showToast('用户名或密码错误', 'error'); return; }
    setCurrentUser(username);
    showToast(`欢迎回来，${username}`, 'success');
    document.getElementById('login-username').value = '';
    document.getElementById('login-password').value = '';
    navigateTo('home');
}

function logout() {
    if (confirm('确定要退出登录吗？')) {
        clearCurrentUser();
        showToast('已退出登录', 'info');
        navigateTo('login');
    }
}

// ---------- 统计 / 剩余票数 ----------
async function renderTicketStats() {
    const res = await api('/stats');
    if (!res.ok) return;
    const tb = res.timeBooking, oq = res.onlineQueue;

    const setHtml = (id, remain, total) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = `<b>${remain}</b> / ${total}`;
    };
    const setFill = (id, percent) => {
        const el = document.getElementById(id);
        if (el) el.style.width = `${percent}%`;
    };
    const setText = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };

    setHtml('home-tb-remain', tb.remain, tb.total);
    setFill('home-tb-progress', tb.percent);
    setHtml('home-oq-remain', oq.remain, oq.total);
    setFill('home-oq-progress', oq.percent);
    setText('tb-stats-remain', tb.remain);
    setText('tb-stats-taken', tb.taken);
    setText('oq-stats-remain', oq.remain);
    setText('oq-stats-taken', oq.taken);
}

// ---------- 状态判断（用于历史/详情显示） ----------
// 单个预约/取号是否"使用中/未签到"：来自后端的权威状态
function deriveStatus(booking) {
    if (booking.status === 'cancelled') return 'cancelled';
    // 餐厅叫号/就餐状态：直接透传叫号中/就餐中/已完成/已过号
    if (booking.status === 'called') return 'called';
    if (booking.status === 'seated') return 'seated';
    if (booking.status === 'done') return 'done';
    if (booking.status === 'passed') return 'passed';
    if (booking.status === 'checked') return 'checked';
    if (booking.status === 'expired') return 'expired';
    // waiting：当天才算有效
    if (booking.date === getTodayDateString()) return 'waiting';
    return 'expired';
}

// 餐厅叫号状态下拉文案
const STATUS_TEXT = {
    waiting: '⏳ 待叫号',
    checked: '✅ 已签到',
    called: '🔊 叫号中',
    seated: '🍽️ 就餐中',
    done: '✅ 就餐完成',
    passed: '↩️ 已过号',
    cancelled: '✖️ 已取消',
    expired: '⏰ 已过期'
};
function tagClass(st) {
    const map = {
        waiting: 'waiting-tag',
        checked: 'active-tag',
        called: 'called-tag',
        seated: 'seated-tag',
        done: 'done-tag',
        passed: 'passed-tag',
        cancelled: 'cancelled-tag',
        expired: 'expired-tag'
    };
    return map[st] || 'waiting-tag';
}

// ---------- 导航 ----------
function navigateTo(page) {
    const pagesNeedAuth = ['home', 'time-booking', 'online-queue', 'history', 'result'];
    if (pagesNeedAuth.includes(page) && !currentUser) {
        showToast('请先登录', 'error');
        page = 'login';
    }

    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

    const pageMap = {
        'login': 'login-page',
        'register': 'register-page',
        'home': 'home-page',
        'time-booking': 'time-booking-page',
        'online-queue': 'online-queue-page',
        'history': 'history-page',
        'result': 'result-page'
    };
    const targetPage = document.getElementById(pageMap[page]);
    if (targetPage) targetPage.classList.add('active');

    if (page === 'time-booking') {
        generateDateTabs();
        if (!selectedBookingDate) selectedBookingDate = getTodayDateString();
        generateTimeSlots();
        selectedTimeSlot = null;
    }
    if (page === 'home') resetForms();
    if (page === 'history') renderHistory();
    if (['home', 'time-booking', 'online-queue'].includes(page)) renderTicketStats();

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetForms() {
    document.getElementById('tb-phone-tail').value = '';
    document.getElementById('tb-people').value = '1';
    document.getElementById('tb-children').value = '0';
    document.getElementById('oq-phone-tail').value = '';
    document.getElementById('oq-people').value = '1';
    document.getElementById('oq-children').value = '0';
}

// ---------- 日期与时间段 ----------
async function loadBookedDates() {
    // 返回当前用户已预约的日期集合
    if (!currentUser) return [];
    const res = await api('/history/' + encodeURIComponent(currentUser));
    if (!res.ok) return [];
    if (!Array.isArray(res.list)) return [];
    return new Set(
        res.list.filter(b => b.type === 'time-booking' && b.status !== 'cancelled')
            .map(b => b.date)
    );
}

async function generateDateTabs() {
    const container = document.getElementById('date-tabs-container');
    if (!container) return;
    const days = generateNext7Days();
    const booked = await loadBookedDates();

    container.innerHTML = '';
    days.forEach(d => {
        const el = document.createElement('div');
        el.className = 'date-tab';
        if (d.key === selectedBookingDate) el.classList.add('selected');
        if (booked.has(d.key)) el.classList.add('booked');

        el.innerHTML = `
            <div class="date-label">${d.label}</div>
            <div class="date-sub">${d.sub}</div>
            ${booked.has(d.key) ? '<div class="date-booked-mark">已约</div>' : ''}
        `;

        el.onclick = () => {
            if (booked.has(d.key)) {
                showToast(`${d.label}（${d.sub}）已经预约过了，每天只能预约一次`, 'error');
                return;
            }
            selectedBookingDate = d.key;
            selectedTimeSlot = null;
            generateDateTabs();
            generateTimeSlots();
        };
        container.appendChild(el);
    });
}

function generateTimeSlots() {
    const container = document.getElementById('time-slots-container');
    container.innerHTML = '';
    const now = new Date();
    const today = getTodayDateString();
    const isToday = selectedBookingDate === today;
    const currentMinutes = isToday ? (now.getHours() * 60 + now.getMinutes()) : -1;

    for (let hour = START_HOUR; hour < END_HOUR; hour++) {
        for (let minute = 0; minute < 60; minute += 30) {
            const slotStartMinutes = hour * 60 + minute;
            const slotEndMinutes = slotStartMinutes + 30;
            const startH = String(hour).padStart(2, '0');
            const startM = String(minute).padStart(2, '0');
            const endH = String(Math.floor(slotEndMinutes / 60)).padStart(2, '0');
            const endM = String(slotEndMinutes % 60).padStart(2, '0');
            const slotText = `${startH}:${startM} - ${endH}:${endM}`;

            const slotEl = document.createElement('div');
            slotEl.className = 'time-slot';
            slotEl.textContent = slotText;
            slotEl.dataset.time = slotText;

            if (isToday && slotStartMinutes < currentMinutes) {
                slotEl.classList.add('disabled');
            } else {
                slotEl.onclick = function() { selectTimeSlot(slotText, slotEl); };
            }
            container.appendChild(slotEl);
        }
    }
}

function selectTimeSlot(time, element) {
    document.querySelectorAll('.time-slot').forEach(s => s.classList.remove('selected'));
    element.classList.add('selected');
    selectedTimeSlot = time;
}

function changeNumber(inputId, delta) {
    const input = document.getElementById(inputId);
    const min = parseInt(input.min || '0', 10);
    const max = parseInt(input.max || '999', 10);
    let value = parseInt(input.value, 10) + delta;
    value = Math.max(min, Math.min(max, value));
    input.value = String(value);
}

// ---------- 提交预约 / 取号 ----------
async function submitTimeBooking() {
    if (!requireLogin()) return;
    if (!selectedBookingDate) selectedBookingDate = getTodayDateString();
    if (!selectedTimeSlot) { showToast('请选择预约时间段', 'error'); return; }

    const phoneTail = document.getElementById('tb-phone-tail').value.trim();
    if (!validatePhoneTail(phoneTail)) { showToast('请输入正确的4位手机尾号', 'error'); return; }

    const people = parseInt(document.getElementById('tb-people').value, 10);
    const children = parseInt(document.getElementById('tb-children').value, 10);
    if (children > people) { showToast('儿童人数不能超过总人数', 'error'); return; }

    const res = await api('/bookings/time', {
        method: 'POST',
        body: { username: currentUser, timeSlot: selectedTimeSlot, phoneTail, people, children, date: selectedBookingDate }
    });
    if (!res.ok) { showToast(res.error || '预约失败', 'error'); return; }

    renderTicketStats();
    showResult(res.booking);
    showToast('预约成功！', 'success');
}

async function submitOnlineQueue() {
    if (!requireLogin()) return;
    const phoneTail = document.getElementById('oq-phone-tail').value.trim();
    if (!validatePhoneTail(phoneTail)) { showToast('请输入正确的4位手机尾号', 'error'); return; }

    const people = parseInt(document.getElementById('oq-people').value, 10);
    const children = parseInt(document.getElementById('oq-children').value, 10);
    if (children > people) { showToast('儿童人数不能超过总人数', 'error'); return; }

    const res = await api('/bookings/queue', {
        method: 'POST',
        body: { username: currentUser, phoneTail, people, children }
    });
    if (!res.ok) { showToast(res.error || '取号失败', 'error'); return; }

    renderTicketStats();
    showResult(res.booking);
    showToast('取号成功！', 'success');
}

// ---------- 结果 / 号码牌 ----------
let lastResultBooking = null;

function showResult(booking) {
    lastResultBooking = booking;
    const isTimeBooking = booking.type === 'time-booking';
    const st = deriveStatus(booking);
    const isCancelled = st === 'cancelled';
    const isActive = st === 'waiting' || st === 'checked';

    document.getElementById('result-icon').textContent = isCancelled ? '❌' : '✅';
    document.getElementById('result-title').textContent = isCancelled
        ? '号码已取消'
        : (isTimeBooking ? '预约成功' : '取号成功');
    document.getElementById('ticket-type').textContent = isTimeBooking ? '预约号码牌' : '排队号码牌';
    document.getElementById('ticket-date').textContent = formatDateDisplay(booking.date);
    document.getElementById('ticket-number').textContent = booking.number;

    const cancelledBanner = document.getElementById('cancelled-banner');
    cancelledBanner.style.display = isCancelled ? 'block' : 'none';

    const cancelBtn = document.getElementById('cancel-btn');
    cancelBtn.style.display = (isActive && !isCancelled) ? 'block' : 'none';

    const timeRow = document.getElementById('ticket-time-row');
    if (isTimeBooking) {
        timeRow.style.display = 'flex';
        document.getElementById('ticket-time').textContent = booking.timeSlot;
    } else {
        timeRow.style.display = 'none';
    }

    // 签到状态行 + 叫号状态 + 桌号
    const checkinRow = document.getElementById('ticket-checkin-row');
    const checkinVal = document.getElementById('ticket-checkin');
    const callingRow = document.getElementById('ticket-calling-row');
    const callingVal = document.getElementById('ticket-calling');
    const tableRow = document.getElementById('ticket-table-row');
    const tableVal = document.getElementById('ticket-table');
    if (checkinRow) {
        checkinRow.style.display = 'flex';
        checkinVal.textContent = STATUS_TEXT[st] || STATUS_TEXT.waiting;
        const colorMap = {
            cancelled: '#d83838', expired: '#999', passed: '#c2185b',
            called: '#f57c00', seated: '#2e7d32', done: '#24a148',
            checked: '#24a148', waiting: '#b58100'
        };
        checkinVal.style.color = colorMap[st] || '#333';
    }
    if (callingRow && st === 'called') {
        callingRow.style.display = 'flex';
        callingVal.textContent = '🔊 您的号码已被呼叫' + (booking.tableNo ? `，请前往 ${booking.tableNo}` : '，请到服务台');
    } else if (callingRow) {
        callingRow.style.display = 'none';
    }
    if (tableRow && booking.tableNo) {
        tableRow.style.display = 'flex';
        tableVal.textContent = '🪑 ' + booking.tableNo;
    } else if (tableRow) {
        tableRow.style.display = 'none';
    }

    document.getElementById('ticket-phone').textContent = `****${booking.phoneTail}`;
    document.getElementById('ticket-people').textContent = `${booking.people} 人`;
    document.getElementById('ticket-children').textContent = `${booking.children} 人`;

    navigateTo('result');
}

async function handleResultCancel() {
    if (!lastResultBooking || !lastResultBooking.id) return;
    if (!confirm('确定要取消这个取号吗？取消后号码将失效。')) return;
    const res = await api('/bookings/' + lastResultBooking.id + '/cancel', { method: 'POST' });
    if (!res.ok) { showToast(res.error || '取消失败', 'error'); return; }
    lastResultBooking = res.booking;
    showToast('已取消取号', 'success');
    showResult(res.booking);
}
async function handleHistoryCancel(event, id) {
    event.stopPropagation();
    if (!confirm('确定要取消这个取号吗？取消后号码将失效。')) return;
    const res = await api('/bookings/' + id + '/cancel', { method: 'POST' });
    if (!res.ok) { showToast(res.error || '取消失败', 'error'); return; }
    showToast('已取消取号', 'success');
    renderHistory();
}

// ---------- 历史记录 ----------
async function renderHistory() {
    if (!requireLogin()) return;
    const today = getTodayDateString();
    const todayBadge = document.getElementById('today-badge');
    todayBadge.textContent = `📅 今天：${formatDateDisplay(today)}`;

    const res = await api('/history/' + encodeURIComponent(currentUser));
    const bookings = (res && Array.isArray(res.list)) ? res.list : [];
    const listEl = document.getElementById('history-list');
    const emptyEl = document.getElementById('history-empty');

    if (bookings.length === 0) {
        listEl.innerHTML = '';
        emptyEl.style.display = 'block';
        return;
    }
    emptyEl.style.display = 'none';
    listEl.innerHTML = '';

    bookings.forEach(booking => {
        const isTimeBooking = booking.type === 'time-booking';
        const isToday = booking.date === today;
        const st = deriveStatus(booking);
        const isCancelled = st === 'cancelled';
        const isActive = ['waiting', 'checked', 'called', 'seated'].includes(st);

        let cardClass = 'history-card';
        if (isToday) cardClass += ' today';
        if (isCancelled) cardClass += ' cancelled';
        else if (st === 'called' || st === 'seated') cardClass += ' live';
        else if (isActive) cardClass += ' active';
        else cardClass += ' expired';

        // 状态标签：优先显示餐厅叫号状态
        const statusTag = `<span class="status-tag ${tagClass(st)}">${STATUS_TEXT[st] || STATUS_TEXT.waiting}</span>`;

        // 可取消：仅待叫号/待签到时可取消
        const canCancel = (st === 'waiting' || st === 'checked') && !isCancelled;
        const cancelBtnHtml = canCancel
            ? `<div class="history-card-foot">
                <button class="cancel-small-btn" onclick="handleHistoryCancel(event, ${booking.id})">取消取号</button>
               </div>`
            : '';

        const card = document.createElement('div');
        card.className = cardClass;
        card.onclick = () => showResult(booking);

        card.innerHTML = `
            <div class="history-card-head">
                <div class="history-badge ${isTimeBooking ? 'badge-time' : 'badge-queue'}">
                    ${isTimeBooking ? '🕐 时间预约' : '🎫 线上取号'}
                </div>
                ${statusTag}
            </div>
            <div class="history-body">
                <div class="history-number ${isTimeBooking ? 'num-4' : 'num-3'} ${isCancelled ? 'strike' : ''}">${booking.number}</div>
                <div class="history-details">
                    <div class="info-row">
                        <span class="info-label">日期</span>
                        <span class="info-value">${formatDateDisplay(booking.date)}</span>
                    </div>
                    ${isTimeBooking ? `
                    <div class="info-row">
                        <span class="info-label">时段</span>
                        <span class="info-value">${booking.timeSlot}</span>
                    </div>
                    ` : ''}
                    <div class="info-row">
                        <span class="info-label">手机尾号</span>
                        <span class="info-value">****${booking.phoneTail}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">人数</span>
                        <span class="info-value">${booking.people}人 · 儿童${booking.children}人</span>
                    </div>
                    ${booking.tableNo ? `
                    <div class="info-row">
                        <span class="info-label">桌号</span>
                        <span class="info-value table-no">🪑 ${booking.tableNo}</span>
                    </div>
                    ` : ''}
                </div>
            </div>
            ${cancelBtnHtml}
        `;
        listEl.appendChild(card);
    });
}

// ---------- 实时叫号状态（首页状态条 + 自动刷新） ----------
function updateLiveCall(queue) {
    const bar = document.getElementById('live-call-bar');
    if (!bar) return;
    const callings = (queue || []).filter(b => b.status === 'called')
        .sort((a, b) => b.calledAt - a.calledAt);
    const cur = callings[0];
    if (!cur) { bar.style.display = 'none'; return; }
    bar.style.display = 'block';
    document.getElementById('live-call-number').textContent = cur.number;
    document.getElementById('live-call-table').textContent = cur.tableNo ? `→ ${cur.tableNo}` : '→ 请到服务台';
}

function initSocket() {
    if (typeof io === 'undefined') return;
    const socket = io();
    socket.on('queue', (data) => {
        updateLiveCall(data && data.queue);
        // 实时刷新当前用户记录，保证叫号状态同步
        if (currentUser) {
            renderHistory();
            if (lastResultBooking && lastResultBooking.id) {
                api('/bookings/' + lastResultBooking.id).then(res => {
                    if (res.ok && res.booking) showResult(res.booking);
                });
            }
        }
    });
    socket.on('called', (data) => {
        updateLiveCall(data && data.queue);
        if (currentUser) renderHistory();
    });
}

// ---------- 初始化 ----------
document.addEventListener('DOMContentLoaded', function() {
    updateUserBar();
    if (restoreLogin()) navigateTo('home');
    else navigateTo('login');
    initSocket();
});