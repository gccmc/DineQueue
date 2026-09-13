// ================= 叫号大屏逻辑 =================

const API = '/api';
let recentCalls = []; // 有桌号的最近叫号（供展示）
let lastQueueData = []; // 最新一次服务端推来的全队

async function api(path, options = {}) {
    try {
        const res = await fetch(API + path, { headers: { 'Content-Type': 'application/json' }, ...options });
        const j = await res.json().catch(() => ({}));
        return { ok: res.ok, ...j };
    } catch (err) {
        return { ok: false };
    }
}

// ---------- 时钟 ----------
function updateClock() {
    const el = document.getElementById('clock');
    const d = new Date();
    const week = ['周日','周一','周二','周三','周四','周五','周六'];
    el.textContent = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}  ${week[d.getDay()]}`;
}

// 按"入队时间"排序（先来先服务）
// - 现场取号(kiosk)：取号即入队，按 createdAt
// - 线上取号/时间预约：签到即入队，按 checkedAt（号码小但后签到也排后面）
function sortByQueueTime(a, b) {
    const tA = a.type === 'kiosk' ? (a.createdAt || 0) : (a.checkedAt || 0);
    const tB = b.type === 'kiosk' ? (b.createdAt || 0) : (b.checkedAt || 0);
    return tA - tB;
}

// 当前叫号：最近一个 status='called' 的号
function findCurrentCalling(queue) {
    const callings = (queue || []).filter(b => b.status === 'called');
    return callings.sort((a, b) => (b.calledAt || 0) - (a.calledAt || 0))[0] || null;
}

// 待叫：
// - 现场取号（kiosk）：取号即进队列，不需要签到，手机尾号是选填
// - 线上取号/时间预约（online-queue / time-booking）：必须已签到（checked）
function getWaitingList(queue) {
    return (queue || [])
        .filter(b => {
            if (b.type === 'kiosk') {
                // 现场取号：waiting/called/seated 状态都算"在排队"（手机尾号选填，不强制）
                return ['waiting', 'called', 'seated', 'passed'].includes(b.status);
            } else {
                // 线上：必须签到
                return b.status === 'checked'
                    && b.phoneTail && String(b.phoneTail).trim() !== '';
            }
        })
        .sort(sortByQueueTime);
}

// 下一位：第一条等待中的号
function getNextOne(waiting) {
    return waiting[0] || null;
}

// 加载初始叫号
async function loadInitial() {
    const res = await api('/admin/queue');
    if (!res.ok || !Array.isArray(res.queue)) return;
    lastQueueData = res.queue;
    res.queue.filter(b => b.status === 'called').forEach(renderCalled);
    renderAll(res.queue);
}

// ---------- 渲染 ----------
function renderAll(queue) {
    queue = queue || lastQueueData || [];
    lastQueueData = queue;
    renderHero(queue);
    renderNextAndQueue(queue);
}

let lastHeroNumber = '';
function renderHero(queue) {
    const cur = findCurrentCalling(queue);
    const heroNumber = document.getElementById('hero-number');
    const heroSub = document.getElementById('hero-sub');
    const heroActive = document.getElementById('hero-active');
    if (cur) {
        heroNumber.textContent = cur.number;
        heroSub.textContent = cur.tableNo ? `请到 ${cur.tableNo} 就餐` : '请到服务台';
        heroNumber.classList.add('big');
        heroActive.textContent = '';
        if (lastHeroNumber !== cur.number) {
            lastHeroNumber = cur.number;
            const hero = document.getElementById('hero-number');
            hero.classList.remove('pop');
            void hero.offsetWidth;
            hero.classList.add('pop');
            // 语音播报
            try {
                if (window.speechSynthesis) {
                    const msg = new SpeechSynthesisUtterance(
                        `请 ${cur.number} 号顾客${cur.tableNo ? ('到 ' + cur.tableNo + ' 就餐') : '到服务台'}`
                    );
                    msg.lang = 'zh-CN';
                    window.speechSynthesis.cancel();
                    window.speechSynthesis.speak(msg);
                }
            } catch (e) {}
        }
    } else {
        if (heroNumber.textContent === '——') return;
        heroNumber.textContent = '——';
        heroSub.textContent = '当前没有叫号';
        heroNumber.classList.remove('big');
        heroActive.textContent = '';
        lastHeroNumber = '';
    }
}

function is4DigitNumber(n) { return String(n).length >= 4; }
function is3DigitNumber(n) { return String(n).length >= 1 && String(n).length <= 3; }

function renderNextAndQueue(queue) {
    const waiting = getWaitingList(queue);
    // 按号码位数分两组（3位/4位）
    const group3 = waiting.filter(b => is3DigitNumber(b.number));
    const group4 = waiting.filter(b => is4DigitNumber(b.number));
    const next3 = getNextOne(group3);
    const next4 = getNextOne(group4);
    // 下一位
    const nextGrid = document.getElementById('next-grid');
    if (next3 || next4) {
        nextGrid.innerHTML = (next3 ? `<div class="next-item n3" title="线上/现场取号">${next3.number}</div>` : '')
            + (next4 ? `<div class="next-item n4" title="时间预约">${next4.number}</div>` : '');
    } else {
        nextGrid.innerHTML = '<div class="next-empty">暂无</div>';
    }
    // 待叫队列：分两个区块（取号队列 + 预约队列）
    const queueGrid = document.getElementById('queue-grid');
    const rest3 = group3.slice(1, 21);
    const rest4 = group4.slice(1, 21);
    if (rest3.length === 0 && rest4.length === 0) {
        queueGrid.innerHTML = '<div class="queue-empty">暂无等待</div>';
    } else {
        let html = '';
        if (rest3.length > 0) {
            html += `<div class="queue-block">
                <div class="queue-block-title">📱 线上/现场取号队列（${group3.length}）</div>
                <div class="queue-grid-inner">${rest3.map(b => `<div class="queue-item n3">${b.number}</div>`).join('')}</div>
            </div>`;
        }
        if (rest4.length > 0) {
            html += `<div class="queue-block">
                <div class="queue-block-title">⏰ 时间预约队列（${group4.length}）</div>
                <div class="queue-grid-inner">${rest4.map(b => `<div class="queue-item n4">${b.number}</div>`).join('')}</div>
            </div>`;
        }
        queueGrid.innerHTML = html;
    }
    // 统计
    const stat = document.getElementById('queue-stat');
    const total = waiting.length;
    const hidden3 = group3.length > 21 ? group3.length - 20 : 0;
    const hidden4 = group4.length > 21 ? group4.length - 20 : 0;
    stat.textContent = `共 ${total} 位（线上 ${group3.length} / 预约 ${group4.length}）`
        + ((hidden3 + hidden4) > 0 ? `，仅显示前 20` : '');
}

function renderCalled(booking) {
    if (booking.status !== 'called') return;
    if (!booking.tableNo) return;
    recentCalls = recentCalls.filter(r => r.number !== booking.number);
    recentCalls.unshift({
        number: booking.number,
        tableNo: booking.tableNo,
        ts: booking.calledAt || Date.now()
    });
    if (recentCalls.length > 6) recentCalls.pop();
    renderRecent();
}

function renderRecent() {
    const list = document.getElementById('recent-list');
    if (!list) return;
    if (recentCalls.length === 0) { list.innerHTML = '<div class="recent-empty">暂无叫号记录</div>'; return; }
    list.innerHTML = recentCalls.map(r => `
        <div class="recent-item">
            <span class="ri-number">${r.number}</span>
            <span class="ri-table">→ ${r.tableNo}</span>
        </div>
    `).join('');
}

// 兼容：服务端推 called/queue 事件
function onCalled(data) {
    const b = data && data.booking;
    if (b) renderCalled(b);
    if (data && Array.isArray(data.queue)) {
        renderAll(data.queue);
    } else {
        // 重新拉一次
        loadInitial();
    }
}

// ---------- 初始化 ----------
document.addEventListener('DOMContentLoaded', () => {
    updateClock();
    setInterval(updateClock, 1000);
    loadInitial();
    if (typeof io !== 'undefined') {
        const socket = io();
        socket.on('called', onCalled);
        socket.on('queue', (data) => {
            if (data && Array.isArray(data.queue)) {
                data.queue.filter(b => b.status === 'called').forEach(renderCalled);
                renderAll(data.queue);
            }
        });
    }
});
