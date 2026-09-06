import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: { origin: '*' }
});
// 数据目录：优先使用环境变量 DATA_DIR（云端持久盘），本地默认项目根目录
const DATA_DIR = process.env.DATA_DIR || __dirname;
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}
const DB_PATH = process.env.DB_PATH ? path.resolve(process.env.DB_PATH)
    : path.join(DATA_DIR, 'data.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// ---------- 常量配置 ----------
const MAX_TIME_BOOKING = 9999;
const MAX_ONLINE_QUEUE = 999;
const START_HOUR = 12;
const END_HOUR = 24;

// ---------- 数据库初始化 ----------
function initDb() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS tickets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL,              -- time-booking | online-queue | kiosk
            number TEXT NOT NULL,            -- 号码牌
            timeSlot TEXT,                   -- 时间段（仅时间预约）
            phoneTail TEXT NOT NULL,         -- 手机尾号 4 位
            people INTEGER NOT NULL DEFAULT 1,
            children INTEGER NOT NULL DEFAULT 0,
            date TEXT NOT NULL,              -- YYYY-MM-DD
            username TEXT,                   -- 预约平台账号（线上产生时）
            status TEXT NOT NULL DEFAULT 'waiting', -- waiting | checked | called | seated | done | passed | cancelled | expired
            tableNo TEXT,                    -- 分配的桌号（叫号时）
            calledAt INTEGER,                -- 叫号时间戳
            seatedAt INTEGER,                -- 就餐（入座）时间戳
            doneAt INTEGER,                  -- 完成时间戳
            checkedAt INTEGER,               -- 签到时间戳
            createdAt INTEGER NOT NULL,
            cancelledAt INTEGER
        );

        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            token TEXT,
            createdAt INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS counters (
            date TEXT NOT NULL,
            type TEXT NOT NULL,
            value INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (date, type)
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );
    `);
    // 兼容旧表：补充叫号/就餐相关字段
    try {
        db.exec(`ALTER TABLE tickets ADD COLUMN tableNo TEXT;`);
    } catch (e) {}
    try {
        db.exec(`ALTER TABLE tickets ADD COLUMN calledAt INTEGER;`);
    } catch (e) {}
    try {
        db.exec(`ALTER TABLE tickets ADD COLUMN seatedAt INTEGER;`);
    } catch (e) {}
    try {
        db.exec(`ALTER TABLE tickets ADD COLUMN doneAt INTEGER;`);
    } catch (e) {}
}
initDb();

// ---------- 工具函数 ----------
const getToday = () => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
};

const formatDateDisplay = (dateStr) => {
    const d = new Date(dateStr);
    const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${weekDays[d.getDay()]}`;
};

function pad(num, len) {
    return String(num).padStart(len, '0');
}

// 获取某个类型当天的下一个号码（自动按天重置）
function getNextNumber(type, max) {
    const today = getToday();
    let row = db.prepare('SELECT value FROM counters WHERE date = ? AND type = ?').get(today, type);
    let value = row ? row.value : 0;
    if (value >= max) return null; // 当天已发完
    const next = value + 1;
    if (row) {
        db.prepare('UPDATE counters SET value = ? WHERE date = ? AND type = ?').run(next, today, type);
    } else {
        db.prepare('INSERT INTO counters (date, type, value) VALUES (?, ?, ?)').run(today, type, next);
    }
    return next;
}

function getStat(type, max) {
    const today = getToday();
    let row = db.prepare('SELECT value FROM counters WHERE date = ? AND type = ?').get(today, type);
    const taken = row ? row.value : 0;
    return {
        taken,
        remain: Math.max(0, max - taken),
        total: max,
        percent: Math.min(100, (taken / max) * 100)
    };
}

// ---------- REST API ----------
app.use(express.json());

// 静态资源（各端前端页面）
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname)); // 兼容旧页面放在根目录

// ---- 用户 ----
app.post('/api/register', (req, res) => {
    const { username, password } = req.body || {};
    if (!/^[a-zA-Z0-9]{3,20}$/.test(username || '')) return res.status(400).json({ error: '用户名需要3-20位字母或数字' });
    if (!password || password.length < 6) return res.status(400).json({ error: '密码至少6位字符' });
    try {
        db.prepare('INSERT INTO users (username, password, createdAt) VALUES (?, ?, ?)')
            .run(username, password, Date.now());
        res.json({ ok: true });
    } catch (e) {
        if (String(e.message).includes('UNIQUE')) return res.status(400).json({ error: '用户名已存在' });
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body || {};
    const user = db.prepare('SELECT * FROM users WHERE username = ? AND password = ?').get(username, password);
    if (!user) return res.status(401).json({ error: '用户名或密码错误' });
    // 简单 token（生成一套用于会话标识）
    const token = crypto.randomBytes(16).toString('hex');
    db.prepare('UPDATE users SET token = ? WHERE id = ?').run(token, user.id);
    res.json({ ok: true, token, username });
});

// ---- 统计（首页/取号页剩余票数） ----
app.get('/api/stats', (req, res) => {
    res.json({
        timeBooking: getStat('time-booking', MAX_TIME_BOOKING),
        onlineQueue: getStat('online-queue', MAX_ONLINE_QUEUE)
    });
});

// ---- 时间预约 ----
app.post('/api/bookings/time', (req, res) => {
    const { username, timeSlot, phoneTail, people, children, date } = req.body || {};
    // 同用户同日只能约一次
    if (username) {
        const dup = db.prepare("SELECT id FROM tickets WHERE username = ? AND date = ? AND type = 'time-booking' AND status != 'cancelled'")
            .get(username, date);
        if (dup) return res.status(400).json({ error: '该日期已经有时间预约了，每天只能预约一次' });
    }
    const number = getNextNumber('time-booking', MAX_TIME_BOOKING);
    if (number === null) return res.status(400).json({ error: '时间预约号码已达今日上限（9999）' });
    const nb = pad(number, 4);
    const info = db.prepare(`INSERT INTO tickets (type, number, timeSlot, phoneTail, people, children, date, username, status, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'waiting', ?)`).run(
        'time-booking', nb, timeSlot, phoneTail, people, children, date, username || null, Date.now());
    const booking = db.prepare('SELECT * FROM tickets WHERE id = ?').get(info.lastInsertRowid);
    pushUpdate();
    res.json({ booking, stats: getStat('time-booking', MAX_TIME_BOOKING) });
});

// ---- 线上取号 ----
app.post('/api/bookings/queue', (req, res) => {
    const { username, phoneTail, people, children } = req.body || {};
    if (username) {
        const active = db.prepare("SELECT * FROM tickets WHERE username = ? AND type = 'online-queue' AND date = ? AND status NOT IN ('cancelled','expired')").get(username, getToday());
        if (active) return res.status(400).json({ error: `您还有活跃的线上取号（号码 ${active.number}）` });
    }
    const number = getNextNumber('online-queue', MAX_ONLINE_QUEUE);
    if (number === null) return res.status(400).json({ error: '线上取号号码已达今日上限（999）' });
    const nb = pad(number, 3);
    const info = db.prepare(`INSERT INTO tickets (type, number, phoneTail, people, children, date, username, status, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'waiting', ?)`).run(
        'online-queue', nb, phoneTail, people, children, getToday(), username || null, Date.now());
    const booking = db.prepare('SELECT * FROM tickets WHERE id = ?').get(info.lastInsertRowid);
    pushUpdate();
    res.json({ booking, stats: getStat('online-queue', MAX_ONLINE_QUEUE) });
});

// ---- 现场取号（自助取号机，直接排队等叫号，无需签到） ----
app.post('/api/kiosk/take', (req, res) => {
    const { phoneTail, people, children } = req.body || {};
    const pt = phoneTail || '';
    const number = getNextNumber('kiosk', MAX_ONLINE_QUEUE);
    if (number === null) return res.status(400).json({ error: '今日现场取号已达上限（999）' });
    const nb = pad(number, 3);
    const info = db.prepare(`INSERT INTO tickets (type, number, phoneTail, people, children, date, username, status, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'waiting', ?)`).run(
        'kiosk', nb, pt, people, children, getToday(), null, Date.now());
    const booking = db.prepare('SELECT * FROM tickets WHERE id = ?').get(info.lastInsertRowid);
    pushUpdate();
    res.json({ booking, stats: getStat('kiosk', MAX_ONLINE_QUEUE) });
});

// ---- 历史记录（按用户） ----
app.get('/api/history/:username', (req, res) => {
    const rows = db.prepare('SELECT * FROM tickets WHERE username = ? ORDER BY createdAt DESC').all(req.params.username);
    res.json(rows);
});

// ---- 签到：按号码牌核对（自助取号机） ----
// 用号码牌查找当天存在的线上取号/时间预约记录
app.get('/api/checkin/lookup', (req, res) => {
    const number = String(req.query.number || '').trim();
    if (!/^\d{3,4}$/.test(number)) return res.json({ found: false });
    const today = getToday();
    const row = db.prepare(
        `SELECT * FROM tickets WHERE number = ? AND date = ? AND type IN ('online-queue','time-booking') AND status NOT IN ('cancelled','expired')`
    ).get(number, today);
    if (!row) return res.json({ found: false });
    // 已经签到过
    if (row.status === 'checked') {
        return res.json({ found: true, checked: true, booking: row });
    }
    res.json({ found: true, checked: false, booking: row });
});

// ---- 签到：二步手机尾号核验 ----
app.post('/api/checkin/verify', (req, res) => {
    const { id, phoneTail } = req.body || {};
    const row = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: '记录不存在' });
    if (String(row.phoneTail) !== String(phoneTail).trim()) {
        return res.json({ verified: false });
    }
    res.json({ verified: true, booking: row });
});

// ---- 签到：确认签到 ----
app.post('/api/checkin/confirm', (req, res) => {
    const { id } = req.body || {};
    const row = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: '记录不存在' });
    if (row.status === 'cancelled' || row.status === 'expired') return res.status(400).json({ error: '该号码已失效' });
    db.prepare("UPDATE tickets SET status = 'checked', checkedAt = ? WHERE id = ?").run(Date.now(), id);
    const updated = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
    pushUpdate();
    res.json({ booking: updated });
});

app.get('/api/bookings/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: '记录不存在' });
    res.json(row);
});

// ---- 取消预约 / 取号 ----
app.post('/api/bookings/:id/cancel', (req, res) => {
    const row = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: '记录不存在' });
    if (row.status === 'cancelled') return res.status(400).json({ error: '该号码已取消' });
    if (row.status === 'checked' || row.status === 'called' || row.status === 'seated' || row.status === 'done' || row.status === 'passed' || row.status === 'expired') {
        return res.status(400).json({ error: '该号码已使用或已过期，无法取消' });
    }
    db.prepare("UPDATE tickets SET status = 'cancelled', cancelledAt = ? WHERE id = ?").run(Date.now(), row.id);
    const updated = db.prepare('SELECT * FROM tickets WHERE id = ?').get(row.id);
    pushUpdate();
    res.json({ booking: updated });
});

// ================= 后台管理接口 =================
// 桌号配置（settings）
function getSetting(key, def) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? JSON.parse(row.value) : def;
}
function setSetting(key, value) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .run(key, JSON.stringify(value));
}

// 获取桌号配置：列表 + 是否自动分配
app.get('/api/admin/settings', (req, res) => {
    res.json({
        tables: getSetting('tables', []),
        autoAssignTable: getSetting('autoAssignTable', false)
    });
});
app.post('/api/admin/settings', (req, res) => {
    const { tables, autoAssignTable } = req.body || {};
    if (tables && Array.isArray(tables)) setSetting('tables', tables);
    if (typeof autoAssignTable === 'boolean') setSetting('autoAssignTable', autoAssignTable);
    res.json({
        tables: getSetting('tables', []),
        autoAssignTable: getSetting('autoAssignTable', false)
    });
});

// 后台队列：当天所有相关记录（含终结状态）
app.get('/api/admin/queue', (req, res) => {
    const today = getToday();
    const rows = db.prepare(
        `SELECT * FROM tickets WHERE date = ? ORDER BY createdAt ASC`
    ).all(today);
    res.json({ queue: rows, settings: getSetting('tables', []) });
});

// 自动分配一张空闲桌号
function pickTableId(preferTable) {
    const tables = getSetting('tables', []);
    if (preferTable) return preferTable;
    if (!tables.length) return '';
    const busy = new Set(db.prepare(
        `SELECT tableNo FROM tickets WHERE date = ? AND tableNo IS NOT NULL AND tableNo != '' AND status IN ('called','seated')`
    ).all(getToday()).map(r => r.tableNo));
    for (const t of tables) if (!busy.has(String(t))) return String(t);
    return '';
}

// 叫号单个号码 id（也可自动叫下一号）
app.post('/api/admin/call', (req, res) => {
    const { id, tableNo } = req.body || {};
    const today = getToday();
    let target = null;
    if (id) {
        target = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
        if (!target) return res.status(404).json({ error: '记录不存在' });
        if (target.date !== today) return res.status(400).json({ error: '只能叫今天的号码' });
        if (target.status !== 'waiting' && target.status !== 'checked' && target.status !== 'passed') {
            return res.status(400).json({ error: '该号码当前无法叫号' });
        }
    } else {
        target = db.prepare(
            `SELECT * FROM tickets WHERE date = ? AND status IN ('waiting','checked','passed')
             ORDER BY createdAt ASC LIMIT 1`
        ).get(today);
        if (!target) return res.status(400).json({ error: '当前没有可叫的号码' });
    }
    const auto = getSetting('autoAssignTable', false);
    const table = auto ? pickTableId(tableNo || '') : (tableNo || '');
    db.prepare("UPDATE tickets SET status = 'called', tableNo = ?, calledAt = ? WHERE id = ?")
        .run(table, Date.now(), target.id);
    const booking = db.prepare('SELECT * FROM tickets WHERE id = ?').get(target.id);
    pushCall(booking);
    pushUpdate();
    res.json({ booking, autoAssignTable: auto });
});

// 重呼：再次推送叫号
app.post('/api/admin/recall', (req, res) => {
    const { id } = req.body || {};
    const booking = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
    if (!booking) return res.status(404).json({ error: '记录不存在' });
    if (booking.status !== 'called') return res.status(400).json({ error: '该号码未被叫号，无法重呼' });
    db.prepare('UPDATE tickets SET calledAt = ? WHERE id = ?').run(Date.now(), id);
    const updated = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
    pushCall(updated);
    res.json({ booking: updated });
});

// 入座（就餐中）
app.post('/api/admin/seat', (req, res) => {
    const { id } = req.body || {};
    const booking = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
    if (!booking) return res.status(404).json({ error: '记录不存在' });
    if (booking.status !== 'called') return res.status(400).json({ error: '只有已叫号的号码才能入座' });
    db.prepare("UPDATE tickets SET status = 'seated', seatedAt = ? WHERE id = ?").run(Date.now(), id);
    const updated = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
    pushUpdate();
    res.json({ booking: updated });
});

// 完成就餐
app.post('/api/admin/done', (req, res) => {
    const { id } = req.body || {};
    const booking = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
    if (!booking) return res.status(404).json({ error: '记录不存在' });
    if (booking.status !== 'seated' && booking.status !== 'called') return res.status(400).json({ error: '该号码当前状态无法完结' });
    db.prepare("UPDATE tickets SET status = 'done', doneAt = ? WHERE id = ?").run(Date.now(), id);
    const updated = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
    pushUpdate();
    res.json({ booking: updated });
});

// 过号（跳号）
app.post('/api/admin/pass', (req, res) => {
    const { id } = req.body || {};
    const booking = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
    if (!booking) return res.status(404).json({ error: '记录不存在' });
    if (booking.status !== 'waiting' && booking.status !== 'checked') {
        return res.status(400).json({ error: '该号码当前无法过号' });
    }
    db.prepare("UPDATE tickets SET status = 'passed' WHERE id = ?").run(id);
    const updated = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
    pushUpdate();
    res.json({ booking: updated });
});

// ---------- 叫号队列快照 ----------
function getActiveQueue() {
    const today = getToday();
    const rows = db.prepare(
        `SELECT * FROM tickets
         WHERE date = ? AND status IN ('waiting','checked','called','seated')
         ORDER BY
            CASE status
                WHEN 'seated' THEN 0
                WHEN 'called' THEN 1
                WHEN 'checked' THEN 2
                WHEN 'waiting' THEN 3
            END,
            createdAt ASC`
    ).all(today);
    return rows;
}
// 当前被叫中的号码（未入座）
function getCurrentCalled() {
    const today = getToday();
    return db.prepare(
        `SELECT * FROM tickets WHERE date = ? AND status = 'called' ORDER BY calledAt DESC`
    ).all(today);
}

// ---------- Socket.IO 实时推送 ----------
function broadcastEvents() {
    const queue = getActiveQueue();
    io.emit('stats', {
        timeBooking: getStat('time-booking', MAX_TIME_BOOKING),
        onlineQueue: getStat('online-queue', MAX_ONLINE_QUEUE)
    });
    io.emit('queue', { queue, called: getCurrentCalled() });
}
function pushUpdate() {
    try { broadcastEvents(); } catch (e) { /* ignore */ }
}
function pushCall(booking) {
    try {
        const queue = getActiveQueue();
        io.emit('called', { booking, queue, called: getCurrentCalled() });
    } catch (e) { /* ignore */ }
}
io.on('connection', () => {
    pushUpdate();
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`✅ 预约系统后端已启动: http://localhost:${PORT}`);
    console.log(`   预约平台: http://localhost:${PORT}/index.html`);
    console.log(`   自助取号机: http://localhost:${PORT}/kiosk.html`);
});