// ================= 演示模式核心（GitHub Pages 专用） =================
// 当部署到 GitHub Pages（无后端）时，本脚本接管全部"接口"，
// 数据存在 localStorage，模拟后端的行为。

(function () {
    if (window.__demoMode) return;
    window.__demoMode = true;

    const STORAGE = {
        USERS: 'demo_users',
        SESSION: 'demo_session',
        TICKETS: 'demo_tickets',
        COUNTERS: 'demo_counters',
        SETTINGS: 'demo_settings',
        CHECKIN: 'demo_checkins' // 号码牌 -> 已签到集合
    };
    const MAX = { TIME: 9999, ONLINE: 999 };

    function load(k, def) {
        try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; }
        catch (e) { return def; }
    }
    function save(k, v) { localStorage.setItem(k, JSON.stringify(v)); }

    function today() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    function now() { return Date.now(); }
    function uid() { return 'tk_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

    // 计数（按天）
    function getCounters() { return load(STORAGE.COUNTERS, {}); }
    function bumpCounter(type) {
        const all = getCounters();
        const t = today();
        if (!all[t]) all[t] = {};
        all[t][type] = (all[t][type] || 0) + 1;
        save(STORAGE.COUNTERS, all);
        return all[t][type];
    }
    function remaining(type) {
        const cap = type === 'time-booking' ? MAX.TIME : MAX.ONLINE;
        const used = (getCounters()[today()] || {})[type] || 0;
        return Math.max(0, cap - used);
    }

    // 票号生成
    function genNumber(type) {
        const idx = bumpCounter(type);
        if (type === 'time-booking') return String(idx).padStart(4, '0');
        return String(idx).padStart(3, '0');
    }

    // 当前票
    function getTickets() { return load(STORAGE.TICKETS, []); }
    function setTickets(arr) { save(STORAGE.TICKETS, arr); }
    function addTicket(t) {
        const arr = getTickets();
        arr.push(t);
        setTickets(arr);
    }
    function updateTicket(id, patch) {
        const arr = getTickets();
        const i = arr.findIndex(t => t.id === id);
        if (i < 0) return null;
        arr[i] = Object.assign({}, arr[i], patch);
        setTickets(arr);
        return arr[i];
    }
    function findTicket(id) { return getTickets().find(t => t.id === id) || null; }
    function findByNumber(number) { return getTickets().find(t => t.number === number) || null; }

    // 事件总线（模拟 socket 实时推送）
    const listeners = {};
    function on(evt, cb) { (listeners[evt] = listeners[evt] || []).push(cb); }
    function off(evt, cb) { if (!listeners[evt]) return; listeners[evt] = listeners[evt].filter(f => f !== cb); }
    function emit(evt, data) { (listeners[evt] || []).forEach(cb => { try { cb(data); } catch (e) {} }); }

    // 简单路由：window.DEMO_API.dispatch(method, path, body) -> 模拟 fetch
    function dispatch(method, path, body) {
        method = (method || 'GET').toUpperCase();
        const respond = (status, data) => ({ status, ok: status >= 200 && status < 300, ...data });
        const segs = path.split('/').filter(Boolean);

        // ---- 注册 / 登录 ----
        if (path === '/api/register' && method === 'POST') {
            const users = load(STORAGE.USERS, []);
            if (users.find(u => u.username === body.username)) return respond(400, { error: '该用户名已注册' });
            const user = { id: 'u_' + Date.now().toString(36), username: body.username, password: body.password, createdAt: now() };
            users.push(user);
            save(STORAGE.USERS, users);
            return respond(200, { user: { id: user.id, username: user.username }, token: 'demo_' + user.id });
        }
        if (path === '/api/login' && method === 'POST') {
            const users = load(STORAGE.USERS, []);
            const u = users.find(x => x.username === body.username && x.password === body.password);
            if (!u) return respond(400, { error: '用户名或密码错误' });
            save(STORAGE.SESSION, u.id);
            return respond(200, { user: { id: u.id, username: u.username }, token: 'demo_' + u.id });
        }
        if (path === '/api/logout' && method === 'POST') {
            localStorage.removeItem(STORAGE.SESSION);
            return respond(200, {});
        }
        if (path === '/api/me' && method === 'GET') {
            const sid = localStorage.getItem(STORAGE.SESSION);
            const u = sid && load(STORAGE.USERS, []).find(x => x.id === sid);
            if (!u) return respond(401, { error: '未登录' });
            return respond(200, { user: { id: u.id, username: u.username } });
        }

        // ---- 统计 ----
        if (path === '/api/stats' && method === 'GET') {
            return respond(200, {
                timeBooking: { used: MAX.TIME - remaining('time-booking'), remaining: remaining('time-booking'), max: MAX.TIME },
                onlineQueue: { used: MAX.ONLINE - remaining('online-queue'), remaining: remaining('online-queue'), max: MAX.ONLINE }
            });
        }

        // ---- 时间预约 ----
        if (path === '/api/time-booking' && method === 'POST') {
            if (remaining('time-booking') <= 0) return respond(400, { error: '今日时间预约号已发完' });
            const slot = body.slot || '';
            const date = body.date || today();
            const tickets = getTickets();
            const sid = localStorage.getItem(STORAGE.SESSION);
            const user = sid && load(STORAGE.USERS, []).find(x => x.id === sid);
            if (user && tickets.find(t => t.username === user.username && t.date === date && t.type === 'time-booking' && t.status !== 'cancelled')) {
                return respond(400, { error: '您今天已经有时间预约' });
            }
            const t = {
                id: uid(),
                number: genNumber('time-booking'),
                type: 'time-booking',
                date,
                slot,
                people: body.people || 1,
                children: body.children || 0,
                phoneTail: body.phoneTail || '',
                username: user ? user.username : null,
                status: 'waiting',
                tableNo: '',
                calledAt: null,
                seatedAt: null,
                doneAt: null,
                checkedAt: null,
                createdAt: now()
            };
            addTicket(t);
            emit('queue', { queue: getActive(), called: getCurrentCalled() });
            return respond(200, { booking: t });
        }

        // ---- 线上取号 ----
        if (path === '/api/online-queue' && method === 'POST') {
            if (remaining('online-queue') <= 0) return respond(400, { error: '今日线上取号已发完' });
            const t = {
                id: uid(),
                number: genNumber('online-queue'),
                type: 'online-queue',
                date: today(),
                slot: '',
                people: body.people || 1,
                children: body.children || 0,
                phoneTail: body.phoneTail || '',
                username: null,
                status: 'waiting',
                tableNo: '',
                calledAt: null,
                seatedAt: null,
                doneAt: null,
                checkedAt: null,
                createdAt: now()
            };
            addTicket(t);
            emit('queue', { queue: getActive(), called: getCurrentCalled() });
            return respond(200, { booking: t });
        }

        // ---- 自助取号 ----
        if (path === '/api/kiosk/take' && method === 'POST') {
            if (remaining('online-queue') <= 0) return respond(400, { error: '今日取号已发完' });
            const t = {
                id: uid(),
                number: genNumber('online-queue'),
                type: 'kiosk',
                date: today(),
                slot: '',
                people: body.people || 1,
                children: body.children || 0,
                phoneTail: body.phoneTail || '',
                username: null,
                status: 'waiting',
                tableNo: '',
                calledAt: null,
                seatedAt: null,
                doneAt: null,
                checkedAt: null,
                createdAt: now()
            };
            addTicket(t);
            emit('queue', { queue: getActive(), called: getCurrentCalled() });
            return respond(200, { booking: t });
        }

        // ---- 我的票（按 username） ----
        if (path === '/api/my-bookings' && method === 'GET') {
            const sid = localStorage.getItem(STORAGE.SESSION);
            const u = sid && load(STORAGE.USERS, []).find(x => x.id === sid);
            if (!u) return respond(401, { error: '未登录' });
            const arr = getTickets().filter(t => t.username === u.username);
            return respond(200, { bookings: arr });
        }
        if (path === '/api/all-bookings' && method === 'GET') {
            return respond(200, { bookings: getTickets() });
        }
        if (path.startsWith('/api/bookings/') && method === 'GET') {
            const id = segs[2];
            const t = findTicket(id);
            if (!t) return respond(404, { error: '记录不存在' });
            return respond(200, { booking: t });
        }
        if (path.startsWith('/api/bookings/') && path.endsWith('/cancel') && method === 'POST') {
            const id = segs[2];
            const t = findTicket(id);
            if (!t) return respond(404, { error: '记录不存在' });
            if (['cancelled', 'called', 'seated', 'done', 'passed', 'expired'].includes(t.status)) {
                return respond(400, { error: '该号码当前状态无法取消' });
            }
            const updated = updateTicket(id, { status: 'cancelled', cancelledAt: now() });
            emit('queue', { queue: getActive(), called: getCurrentCalled() });
            return respond(200, { booking: updated });
        }

        // ---- 签到 ----
        if (path === '/api/checkin' && method === 'POST') {
            const { number, phoneTail } = body || {};
            const t = findByNumber(number);
            if (!t) return respond(404, { error: '号码牌 ' + number + ' 不存在' });
            if (t.phoneTail !== phoneTail) return respond(400, { error: '手机尾号与该号码牌不匹配' });
            if (['called', 'seated', 'done', 'cancelled'].includes(t.status)) {
                return respond(400, { error: '该号码牌当前状态无法签到' });
            }
            const updated = updateTicket(t.id, { status: 'checked', checkedAt: now() });
            emit('queue', { queue: getActive(), called: getCurrentCalled() });
            return respond(200, { booking: updated });
        }

        // ---- 后台：队列 / 配置 ----
        if (path === '/api/admin/queue' && method === 'GET') {
            const settings = load(STORAGE.SETTINGS, { tables: [], autoAssignTable: false });
            return respond(200, { queue: getTickets(), settings: settings.tables || [] });
        }
        if (path === '/api/admin/settings' && method === 'GET') {
            const s = load(STORAGE.SETTINGS, { tables: [], autoAssignTable: false });
            return respond(200, s);
        }
        if (path === '/api/admin/settings' && method === 'POST') {
            const cur = load(STORAGE.SETTINGS, { tables: [], autoAssignTable: false });
            const next = Object.assign({}, cur, body || {});
            save(STORAGE.SETTINGS, next);
            return respond(200, next);
        }
        if (path === '/api/admin/call' && method === 'POST') {
            const tickets = getTickets();
            const t = body.id
                ? tickets.find(x => x.id === body.id)
                : tickets.filter(x => ['waiting', 'checked', 'passed'].includes(x.status) && x.date === today())
                    .sort((a, b) => a.createdAt - b.createdAt)[0];
            if (!t) return respond(400, { error: '没有可叫的号码' });
            const settings = load(STORAGE.SETTINGS, { tables: [], autoAssignTable: false });
            let tableNo = body.tableNo || '';
            if (settings.autoAssignTable && !tableNo) {
                const busy = new Set(tickets.filter(x => x.tableNo && ['called', 'seated'].includes(x.status)).map(x => x.tableNo));
                tableNo = (settings.tables || []).find(tb => !busy.has(tb)) || '';
            }
            const updated = updateTicket(t.id, { status: 'called', tableNo, calledAt: now() });
            emit('called', { booking: updated, queue: getActive(), called: getCurrentCalled() });
            emit('queue', { queue: getActive(), called: getCurrentCalled() });
            return respond(200, { booking: updated, autoAssignTable: settings.autoAssignTable });
        }
        if (path === '/api/admin/recall' && method === 'POST') {
            const t = findTicket(body.id);
            if (!t || t.status !== 'called') return respond(400, { error: '号码不在叫号状态' });
            const updated = updateTicket(t.id, { calledAt: now() });
            emit('called', { booking: updated, queue: getActive(), called: getCurrentCalled() });
            return respond(200, { booking: updated });
        }
        if (path === '/api/admin/seat' && method === 'POST') {
            const t = findTicket(body.id);
            if (!t || t.status !== 'called') return respond(400, { error: '该号码未被叫号' });
            const updated = updateTicket(t.id, { status: 'seated', seatedAt: now() });
            emit('queue', { queue: getActive(), called: getCurrentCalled() });
            return respond(200, { booking: updated });
        }
        if (path === '/api/admin/done' && method === 'POST') {
            const t = findTicket(body.id);
            if (!t || !['called', 'seated'].includes(t.status)) return respond(400, { error: '该号码当前无法完结' });
            const updated = updateTicket(t.id, { status: 'done', doneAt: now() });
            emit('queue', { queue: getActive(), called: getCurrentCalled() });
            return respond(200, { booking: updated });
        }
        if (path === '/api/admin/pass' && method === 'POST') {
            const t = findTicket(body.id);
            if (!t || !['waiting', 'checked'].includes(t.status)) return respond(400, { error: '该号码当前无法过号' });
            const updated = updateTicket(t.id, { status: 'passed' });
            emit('queue', { queue: getActive(), called: getCurrentCalled() });
            return respond(200, { booking: updated });
        }

        return respond(404, { error: '演示模式接口不存在: ' + method + ' ' + path });
    }

    function getActive() {
        return getTickets().filter(t => t.date === today() && ['waiting', 'checked', 'called', 'seated'].includes(t.status));
    }
    function getCurrentCalled() {
        return getTickets().filter(t => t.date === today() && t.status === 'called').sort((a, b) => b.calledAt - a.calledAt);
    }

    // 探测是否在演示环境：当前 host 是 github.io 或用户主动开启
    function detectDemo() {
        if (/\.github\.io$/.test(location.hostname)) return true;
        if (location.search.includes('demo=1')) return true;
        return false;
    }
    if (!detectDemo()) return;

    // 接管 fetch
    const _fetch = window.fetch;
    window.fetch = function (url, options) {
        options = options || {};
        let path;
        if (typeof url === 'string') {
            try { path = new URL(url, location.origin).pathname; } catch (e) { path = url; }
        } else { path = url.url; }
        if (typeof path === 'string' && path.startsWith('/api/')) {
            const method = (options.method || 'GET').toUpperCase();
            let body = {};
            if (options.body) {
                if (typeof options.body === 'string') {
                    try { body = JSON.parse(options.body); } catch (e) {}
                } else { body = options.body; }
            }
            return new Promise(resolve => {
                setTimeout(() => {
                    const r = dispatch(method, path, body);
                    resolve(new Response(JSON.stringify(r), {
                        status: r.status,
                        headers: { 'Content-Type': 'application/json' }
                    }));
                }, 50);
            });
        }
        return _fetch.apply(this, arguments);
    };

    // 接管 WebSocket / Socket.IO 客户端不存在的情况：给一个 emit
    window.io = function () {
        const sock = {
            on(evt, cb) { on(evt, cb); },
            off(evt, cb) { off(evt, cb); },
            emit() {}
        };
        // 立即推一次当前状态
        setTimeout(() => emit('queue', { queue: getActive(), called: getCurrentCalled() }), 30);
        return sock;
    };

    // 提示条：右下角显示"演示模式"
    document.addEventListener('DOMContentLoaded', () => {
        const tip = document.createElement('div');
        tip.textContent = '🌐 演示版（数据存本机，无后端）';
        tip.style.cssText = 'position:fixed;bottom:14px;right:14px;background:rgba(0,0,0,0.78);color:#fff;padding:8px 14px;border-radius:18px;font-size:13px;z-index:9999;';
        document.body.appendChild(tip);
    });

    window.__demoEmit = emit;
})();