// ================= 叫号大屏逻辑 =================

const API = '/api';
let recentCalls = []; // 有桌号的最近叫号（供展示）

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

// 读取当天初始叫号记录
async function loadInitial() {
    const res = await api('/admin/queue');
    if (!res.ok || !Array.isArray(res.queue)) return;
    res.queue.forEach(b => renderCalled(b));
    refreshHero(res.queue);
}

// ---------- 渲染 ----------
let lastHeroTs = 0;
function refreshHero(queue) {
    const callings = (queue || []).filter(b => b.status === 'called');
    const cur = callings.sort((a,b)=>b.calledAt-a.calledAt)[0];
    const hero = document.getElementById('hero');
    const heroNumber = document.getElementById('hero-number');
    const heroSub = document.getElementById('hero-sub');
    const heroActive = document.getElementById('hero-active');
    if (cur) {
        heroNumber.textContent = cur.number;
        heroSub.textContent = cur.tableNo ? `请到 ${cur.tableNo} 就餐` : '请到服务台';
        heroNumber.classList.add('big');
        heroActive.textContent = '';
    } else {
        if (heroNumber.textContent === '——') return;
        heroNumber.textContent = '——';
        heroSub.textContent = '当前没有叫号';
        heroNumber.classList.remove('big');
        heroActive.textContent = '';
    }
}

function renderCalled(booking) {
    if (booking.status !== 'called') return;
    if (!booking.tableNo) return; // 无桌号只在大区显示，不进列表
    // 去重：相同号码保留最新
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
    if (recentCalls.length === 0) { list.innerHTML = '<div class="recent-empty">暂无叫号记录</div>'; return; }
    list.innerHTML = recentCalls.map(r => `
        <div class="recent-item">
            <span class="ri-number">${r.number}</span>
            <span class="ri-table">→ ${r.tableNo}</span>
        </div>
    `).join('');
}

// 叫号时大区动画 + 可播报
function onCalled(data) {
    const b = data && data.booking;
    if (!b) return;
    renderCalled(b);
    refreshHero(data.queue);
    // 高亮闪烁动画
    const hero = document.getElementById('hero-number');
    hero.classList.remove('pop');
    void hero.offsetWidth;
    hero.classList.add('pop');
    // 尝试语音播报（如浏览器支持）
    try {
        if (window.speechSynthesis) {
            const msg = new SpeechSynthesisUtterance(
                `请 ${b.number} 号顾客${b.tableNo ? ('到 ' + b.tableNo + ' 就餐') : '到服务台'}`
            );
            msg.lang = 'zh-CN';
            window.speechSynthesis.cancel();
            window.speechSynthesis.speak(msg);
        }
    } catch (e) {}
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
            const queue = data.queue || [];
            queue.forEach(renderCalled);
            refreshHero(queue);
        });
    }
});