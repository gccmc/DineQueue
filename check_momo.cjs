const Database = require('better-sqlite3');
const db = new Database('e:/新建文件夹 (8)/dhd/data.db', { readonly: true });
console.log('=== 用户列表 ===');
console.table(db.prepare('SELECT id, username FROM users').all());
const u = db.prepare("SELECT id FROM users WHERE username = ?").get('momo');
if (u) {
    console.log('\n=== momo 的所有票 ===');
    console.table(db.prepare('SELECT id, number, type, status, date, username, phoneTail, createdAt FROM tickets WHERE username = ? OR phoneTail IS NOT NULL ORDER BY id DESC LIMIT 20').all(u.id));
} else {
    console.log('用户 momo 不存在');
}