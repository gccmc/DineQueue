import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';

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
            status TEXT NOT NULL DEFAULT 'waiting', -- waiting | checked | called | arrived | seated | done | passed | cancelled | expired
            tableNo TEXT,                    -- 分配的桌号（叫号时）
            token TEXT,                      -- 每张票唯一的二维码秘钥
            calledAt INTEGER,                -- 叫号时间戳
            arrivedAt INTEGER,               -- 顾客到店确认时间戳
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
        db.exec(`ALTER TABLE tickets ADD COLUMN token TEXT;`);
    } catch (e) {}
    try {
        db.exec(`ALTER TABLE tickets ADD COLUMN arrivedAt INTEGER;`);
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

// 每张票唯一的二维码秘钥（16位十六进制）
function genToken() {
    return crypto.randomBytes(8).toString('hex');
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
        // 只挡仍在"使用中"（waiting/checked/called/seated）的同名当日记录
        // 已取消/已过号/已使用/已过期的都不挡，允许用户重新预约
        const dup = db.prepare("SELECT id FROM tickets WHERE username = ? AND date = ? AND type = 'time-booking' AND status IN ('waiting','checked','called','seated')")
            .get(username, date);
        if (dup) return res.status(400).json({ error: '该日期已有进行中的预约，请先取消后再约' });
    }
    const number = getNextNumber('time-booking', MAX_TIME_BOOKING);
    if (number === null) return res.status(400).json({ error: '时间预约号码已达今日上限（9999）' });
    const nb = pad(number, 4);
    const info = db.prepare(`INSERT INTO tickets (type, number, timeSlot, phoneTail, people, children, date, username, status, token, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'waiting', ?, ?)`).run(
        'time-booking', nb, timeSlot, phoneTail, people, children, date, username || null, genToken(), Date.now());
    const booking = db.prepare('SELECT * FROM tickets WHERE id = ?').get(info.lastInsertRowid);
    pushUpdate();
    res.json({ booking, stats: getStat('time-booking', MAX_TIME_BOOKING) });
});

// ---- 线上取号 ----
app.post('/api/bookings/queue', (req, res) => {
    const { username, phoneTail, people, children } = req.body || {};
    if (username) {
        // 只挡"还在排队中"的号，已完成/已过号/已取消/已过期的都不挡，允许重新取号
        const active = db.prepare("SELECT * FROM tickets WHERE username = ? AND type = 'online-queue' AND date = ? AND status IN ('waiting','checked','called','seated')").get(username, getToday());
        if (active) return res.status(400).json({ error: `您还有进行中的线上取号（号码 ${active.number}）` });
    }
    const number = getNextNumber('online-queue', MAX_ONLINE_QUEUE);
    if (number === null) return res.status(400).json({ error: '线上取号号码已达今日上限（999）' });
    const nb = pad(number, 3);
    const info = db.prepare(`INSERT INTO tickets (type, number, phoneTail, people, children, date, username, status, token, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'waiting', ?, ?)`).run(
        'online-queue', nb, phoneTail, people, children, getToday(), username || null, genToken(), Date.now());
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
    const info = db.prepare(`INSERT INTO tickets (type, number, phoneTail, people, children, date, username, status, token, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'waiting', ?, ?)`).run(
        'kiosk', nb, pt, people, children, getToday(), null, genToken(), Date.now());
    const booking = db.prepare('SELECT * FROM tickets WHERE id = ?').get(info.lastInsertRowid);
    pushUpdate();
    res.json({ booking, stats: getStat('kiosk', MAX_ONLINE_QUEUE) });
});

// ---- 历史记录（按用户） ----
app.get('/api/history/:username', (req, res) => {
    const rows = db.prepare('SELECT * FROM tickets WHERE username = ? ORDER BY createdAt DESC').all(req.params.username);
    res.json(rows);
});

// ---- 查询某票前面还有几人（仅已签到的票才返回有效位置） ----
app.get('/api/position/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const target = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
    if (!target) return res.status(404).json({ error: '记录不存在' });
    if (target.date !== getToday()) return res.json({ ahead: 0, status: target.status, checked: false });
    if (target.status !== 'checked') {
        // 未签到：返回 0（让前端显示"未签到"）
        return res.json({ ahead: 0, status: target.status, checked: false });
    }
    // 找出同日同 type 已签到 且号码比自己小的票数
    const ahead = db.prepare(
        `SELECT COUNT(*) AS c FROM tickets WHERE date = ? AND type = ? AND status = 'checked'
         AND phoneTail IS NOT NULL AND phoneTail != ''
         AND number < ?`
    ).get(target.date, target.type, target.number).c;
    res.json({ ahead, status: target.status, checked: true });
});

// ---- 签到：按号码牌核对（自助取号机） ----
// 用号码牌查找当天存在的预约/取号记录（含线上、时间预约、现场取号）
app.get('/api/checkin/lookup', (req, res) => {
    const number = String(req.query.number || '').trim();
    if (!/^\d{3,4}$/.test(number)) return res.json({ found: false });
    const today = getToday();
    // 号码可能在多个 type 间撞号（如线上 012 和现场 012）。
    // 排序优先级：1)线上/时间预约且 waiting（可签到）  2)kiosk 且 waiting（现场取号等待中）  3)其他状态
    const row = db.prepare(
        `SELECT * FROM tickets WHERE number = ? AND date = ? AND type IN ('online-queue','time-booking','kiosk')
         ORDER BY
            CASE
                WHEN type IN ('online-queue','time-booking') AND status = 'waiting' THEN 0
                WHEN type = 'kiosk' AND status = 'waiting' THEN 1
                ELSE 2
            END,
            id DESC
         LIMIT 1`
    ).get(number, today);
    if (!row) return res.json({ found: false });
    // 现场取号(kiosk)不需要签到，取号即进队列等叫号
    if (row.type === 'kiosk') {
        return res.json({ found: true, checkable: false, status: 'kiosk', booking: row });
    }
    // 只有 waiting 状态才允许走签到流程
    if (row.status === 'waiting') {
        return res.json({ found: true, checkable: true, booking: row });
    }
    // 其他状态：返回 found + 当前状态，前端给不同提示
    return res.json({ found: true, checkable: false, status: row.status, booking: row });
});

// ---- 签到：二步手机尾号核验 ----
app.post('/api/checkin/verify', (req, res) => {
    const { id, phoneTail } = req.body || {};
    const row = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: '记录不存在' });
    // 状态校验：只有 waiting 状态允许走签到流程
    if (['cancelled', 'expired'].includes(row.status)) {
        return res.status(400).json({ verified: false, error: '该号码已失效' });
    }
    if (['checked', 'called', 'arrived', 'seated', 'done', 'passed'].includes(row.status)) {
        return res.status(400).json({ verified: false, error: '该号码已使用，无法再次签到' });
    }
    if (row.status !== 'waiting') {
        return res.status(400).json({ verified: false, error: '该号码当前不允许签到' });
    }
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
    if (row.status === 'cancelled' || row.status === 'expired') {
        return res.status(400).json({ error: '该号码已失效' });
    }
    if (['checked', 'called', 'arrived', 'seated', 'done', 'passed'].includes(row.status)) {
        return res.status(400).json({ error: '该号码已使用，无法再次签到' });
    }
    if (row.status !== 'waiting') {
        return res.status(400).json({ error: '该号码当前状态不允许签到' });
    }
    db.prepare("UPDATE tickets SET status = 'checked', checkedAt = ? WHERE id = ?").run(Date.now(), id);
    const updated = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
    pushUpdate();
    res.json({ booking: updated });
});

// ---- 签到：扫码签到（自助取号机扫顾客手机上的到店码） ----
app.post('/api/checkin/scan', (req, res) => {
    const p = parseTicketPayload((req.body || {}).payload);
    if (!p) return res.status(400).json({ error: '二维码无效' });
    const row = db.prepare('SELECT * FROM tickets WHERE id = ?').get(p.id);
    if (!row || !row.token || row.token !== p.token) {
        return res.status(400).json({ error: '二维码无效' });
    }
    if (row.type === 'kiosk') {
        return res.status(400).json({ error: '现场取号无需签到，请直接等候叫号' });
    }
    if (row.status === 'cancelled' || row.status === 'expired') {
        return res.status(400).json({ error: '该号码已失效' });
    }
    if (['checked', 'called', 'arrived', 'seated', 'done', 'passed'].includes(row.status)) {
        const map = {
            checked: '该号码已签到', called: '该号码已被叫号', arrived: '该号码已到店',
            seated: '该号码正在就餐', done: '该号码已就餐完成', passed: '该号码已过号'
        };
        return res.status(400).json({ error: map[row.status] || '该号码已使用' });
    }
    if (row.status !== 'waiting') {
        return res.status(400).json({ error: '该号码当前不允许签到' });
    }
    db.prepare("UPDATE tickets SET status = 'checked', checkedAt = ? WHERE id = ?").run(Date.now(), p.id);
    const updated = db.prepare('SELECT * FROM tickets WHERE id = ?').get(p.id);
    pushUpdate();
    res.json({ ok: true, booking: updated });
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
    if (row.status === 'checked' || row.status === 'called' || row.status === 'arrived' || row.status === 'seated' || row.status === 'done' || row.status === 'passed' || row.status === 'expired') {
        return res.status(400).json({ error: '该号码已使用或已过期，无法取消' });
    }
    db.prepare("UPDATE tickets SET status = 'cancelled', cancelledAt = ? WHERE id = ?").run(Date.now(), row.id);
    const updated = db.prepare('SELECT * FROM tickets WHERE id = ?').get(row.id);
    pushUpdate();
    res.json({ booking: updated });
});

// ================= 二维码 / 确认机接口 =================
// 对外返回给确认机显示的票信息（屏蔽 token、不泄露手机尾号）
function publicTicket(t) {
    if (!t) return null;
    return {
        id: t.id,
        type: t.type,
        number: t.number,
        timeSlot: t.timeSlot || null,
        phoneTail: t.phoneTail ? ('****' + t.phoneTail) : '',
        people: t.people,
        children: t.children,
        date: t.date,
        status: t.status,
        tableNo: t.tableNo || '',
        username: t.username || null
    };
}

// 解析二维码内嵌内容 DHD:<id>:<token>
function parseTicketPayload(payload) {
    const m = /^DHD:(\d+):([0-9a-f]{16})$/.exec(String(payload || '').trim());
    return m ? { id: parseInt(m[1], 10), token: m[2] } : null;
}

// 二维码内容（给各端生成二维码用）
app.get('/api/ticket/qr/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
    if (!row || !row.token) return res.status(404).json({ error: '记录不存在' });
    res.json({ payload: `DHD:${row.id}:${row.token}` });
});

// 现场取号绑定到预约平台账号：扫码(id+token) 或 手动(号码+手机尾号)
app.post('/api/ticket/bind', (req, res) => {
    const { id, token, username, number, phoneTail } = req.body || {};
    if (!username) return res.status(400).json({ error: '请先登录预约平台' });
    let row = null;
    if (id && token) {
        row = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
        if (!row || !row.token || row.token !== String(token).trim()) {
            return res.status(400).json({ error: '二维码无效，请重新扫描' });
        }
    } else if (number && phoneTail) {
        row = db.prepare(
            `SELECT * FROM tickets WHERE number = ? AND date = ? AND phoneTail = ? AND username IS NULL
             ORDER BY id DESC LIMIT 1`
        ).get(String(number).trim(), getToday(), String(phoneTail).trim());
        if (!row) return res.status(400).json({ error: '找不到可绑定的号码，请确认号码与手机尾号' });
    } else {
        return res.status(400).json({ error: '缺少绑定信息' });
    }
    if (row.username && row.username !== username) {
        return res.status(400).json({ error: '该号码已绑定其他账号' });
    }
    db.prepare('UPDATE tickets SET username = ? WHERE id = ?').run(username, row.id);
    const updated = db.prepare('SELECT * FROM tickets WHERE id = ?').get(row.id);
    pushUpdate();
    res.json({ booking: updated });
});

// 确认机：解析扫码（DHD:id:token）
app.post('/api/confirm/resolve', (req, res) => {
    const p = parseTicketPayload((req.body || {}).payload);
    if (!p) return res.json({ ok: false, error: '二维码无效' });
    const row = db.prepare('SELECT * FROM tickets WHERE id = ?').get(p.id);
    if (!row || !row.token || row.token !== p.token) return res.json({ ok: false, error: '二维码无效' });
    res.json({ ok: true, booking: publicTicket(row) });
});

// 确认机：手动输入号码查找
app.post('/api/confirm/lookup', (req, res) => {
    const n = String((req.body || {}).number || '').trim();
    if (!/^\d{3,4}$/.test(n)) return res.json({ ok: false, error: '请输入3-4位号码牌' });
    const row = db.prepare(
        `SELECT * FROM tickets WHERE number = ? AND date = ? AND type IN ('online-queue','time-booking','kiosk')
         ORDER BY
            CASE status
                WHEN 'called' THEN 0
                WHEN 'arrived' THEN 1
                WHEN 'seated' THEN 2
                WHEN 'done' THEN 3
                ELSE 4
            END,
            id DESC
         LIMIT 1`
    ).get(n, getToday());
    if (!row) return res.json({ ok: false, error: '今天没有这个号码，请核对后重试' });
    res.json({ ok: true, booking: publicTicket(row) });
});

// 确认机：确认到店（status: called → arrived）
app.post('/api/confirm/arrive', (req, res) => {
    const { id, token } = req.body || {};
    const row = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: '记录不存在' });
    if (row.token && token && row.token !== String(token).trim()) {
        return res.status(400).json({ error: '二维码不匹配' });
    }
    if (row.status !== 'called') {
        const map = {
            arrived: '该号码已确认到店',
            seated: '该号码已在就餐中',
            done: '该号码已完成就餐',
            passed: '该号码已过号',
            waiting: '该号码还未被叫到，请耐心等候',
            checked: '该号码还未被叫到，请耐心等候',
            cancelled: '该号码已取消',
            expired: '该号码已失效'
        };
        return res.status(400).json({ error: map[row.status] || '当前状态无法确认' });
    }
    db.prepare("UPDATE tickets SET status = 'arrived', arrivedAt = ? WHERE id = ?").run(Date.now(), row.id);
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
        // 手动指定 id：可以叫 waiting/checked/passed（管理员强制）
        if (!['waiting', 'checked', 'passed'].includes(target.status)) {
            return res.status(400).json({ error: '该号码当前无法叫号' });
        }
    } else {
        // 自动叫下一号：按"入队时间"统一排序（先来先服务）
        // - 现场取号(kiosk)：取号即入队，按 createdAt
        // - 线上取号/时间预约(online-queue/time-booking)：签到即入队，按 checkedAt
        //   即使号码小，后签到也排后面
        target = db.prepare(
            `SELECT * FROM tickets WHERE date = ? AND (
                (type = 'kiosk' AND status = 'waiting')
                OR
                (type IN ('online-queue','time-booking') AND status = 'checked'
                 AND phoneTail IS NOT NULL AND phoneTail != ''
                 AND checkedAt IS NOT NULL)
             )
             ORDER BY
                CASE
                    WHEN type = 'kiosk' THEN createdAt
                    ELSE checkedAt
                END ASC
             LIMIT 1`
        ).get(today);
        if (!target) {
            return res.status(400).json({ error: '当前没有可叫的号码（线上需先到店签到）' });
        }
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
    if (booking.status !== 'called' && booking.status !== 'arrived') return res.status(400).json({ error: '只有已叫号或已到店的号码才能入座' });
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
    if (booking.status !== 'seated' && booking.status !== 'called' && booking.status !== 'arrived') return res.status(400).json({ error: '该号码当前状态无法完结' });
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
         WHERE date = ? AND status IN ('waiting','checked','called','arrived','seated')
         ORDER BY
            CASE status
                WHEN 'seated' THEN 0
                WHEN 'arrived' THEN 1
                WHEN 'called' THEN 2
                WHEN 'checked' THEN 3
                WHEN 'waiting' THEN 4
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

// ---------- LAN IP 信息（公网/局域网访问用）----------
app.get('/api/lan-info', (req, res) => {
    const ifs = os.networkInterfaces();
    const ipv4 = [];
    const ipv6 = [];
    for (const name of Object.keys(ifs)) {
        for (const i of ifs[name]) {
            if (i.internal) continue;
            if (i.family === 'IPv4') ipv4.push(i.address);
            else if (i.family === 'IPv6') ipv6.push(i.address);
        }
    }
    // 找本机的全局 IPv6（公网 IPv6 通常是 240x/200x 开头）
    const myPublicIPv6 = ipv6.find(ip => !ip.startsWith('fe80:') && !ip.startsWith('fd') && !ip.startsWith('::1')) || null;
    res.json({
        port: PORT,
        ipv4: ipv4.filter(ip => !ip.startsWith('169.254.')),  // 过滤 link-local
        ipv6: ipv6.filter(ip => !ip.startsWith('fe80:')),     // 只保留全局 IPv6
        publicIPv4: null,  // 运营商未分配
        publicIPv6: myPublicIPv6
    });
});

const PORT = process.env.PORT || 3000;
function getLocalIPs() {
    const ifs = os.networkInterfaces();
    const out = [];
    for (const name of Object.keys(ifs)) {
        for (const i of ifs[name]) {
            if (i.family === 'IPv4' && !i.internal) out.push(i.address);
        }
    }
    return out;
}
httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✅ 预约系统后端已启动`);
    console.log(`   本机访问:   http://localhost:${PORT}`);
    console.log(`   预约平台:   http://localhost:${PORT}/index.html`);
    console.log(`   自助取号机: http://localhost:${PORT}/kiosk.html`);
    console.log(`   叫号大屏:   http://localhost:${PORT}/display.html`);
    console.log(`   后台管理:   http://localhost:${PORT}/admin.html`);
    console.log(`   到店确认台: http://localhost:${PORT}/confirm.html`);
    const ips = getLocalIPs();
    if (ips.length) {
        console.log(`\n📡 局域网（店内设备）访问:`);
        for (const ip of ips) {
            console.log(`   http://${ip}:${PORT}`);
        }
    } else {
        console.log(`\n⚠️  未检测到局域网网卡，请检查 WiFi/有线是否已连接`);
    }
    console.log('');
});