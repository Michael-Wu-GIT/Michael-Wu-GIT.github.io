const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { Pool } = require('pg');

const PORT = Number(process.env.PORT) || 3000;
const ROOT_DIR = __dirname;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '*';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const usePostgres = Boolean(process.env.DATABASE_URL);
const DATA_DIR = path.join(ROOT_DIR, 'data');
const DATABASE_FILE = path.join(DATA_DIR, 'messages.db');

let database;
let pool;

async function initializeDatabase() {
    if (usePostgres) {
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        });
        await pool.query(`
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);
        return;
    }

    fs.mkdirSync(DATA_DIR, { recursive: true });
    database = new DatabaseSync(DATABASE_FILE);
    database.exec(`
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);
}

async function getMessages() {
    if (usePostgres) {
        const result = await pool.query(`
            SELECT id, name, content, created_at
            FROM messages
            ORDER BY id DESC
            LIMIT 100
        `);
        return result.rows;
    }

    return database.prepare(`
        SELECT id, name, content, created_at
        FROM messages
        ORDER BY id DESC
        LIMIT 100
    `).all();
}

async function saveMessage(name, content) {
    if (usePostgres) {
        const result = await pool.query(
            'INSERT INTO messages (name, content) VALUES ($1, $2) RETURNING id',
            [name, content]
        );
        return result.rows[0].id;
    }

    const result = database.prepare(
        'INSERT INTO messages (name, content) VALUES (?, ?)'
    ).run(name, content);
    return Number(result.lastInsertRowid);
}

function sendJson(response, statusCode, payload) {
    const body = JSON.stringify(payload);
    response.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': FRONTEND_ORIGIN,
        'Vary': 'Origin',
        'Cache-Control': 'no-store'
    });
    response.end(body);
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function hasBasicAdminAccess(request) {
    const authorization = request.headers.authorization || '';
    if (!authorization.startsWith('Basic ')) return false;

    const credentials = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
    return credentials === `admin:${ADMIN_TOKEN}`;
}

function sendMessagesTable(response, messages) {
    const rows = messages.map(message => `
        <tr>
            <td>${escapeHtml(message.id)}</td>
            <td>${escapeHtml(message.name)}</td>
            <td><pre>${escapeHtml(message.content)}</pre></td>
            <td>${escapeHtml(new Date(message.created_at).toLocaleString('zh-CN'))}</td>
        </tr>
    `).join('');
    const body = `<!doctype html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>留言管理</title>
    <style>
        body { margin: 0; padding: 32px; color: #222; background: #f4f6f8; font: 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        main { max-width: 1200px; margin: 0 auto; }
        h1 { margin: 0 0 8px; }
        p { color: #667085; }
        .table-wrap { overflow-x: auto; background: #fff; border: 1px solid #dfe3e8; border-radius: 10px; box-shadow: 0 4px 16px rgba(16, 24, 40, .06); }
        table { width: 100%; border-collapse: collapse; min-width: 720px; }
        th, td { padding: 14px 16px; text-align: left; vertical-align: top; border-bottom: 1px solid #eaecf0; }
        th { color: #344054; background: #f9fafb; font-weight: 600; }
        tr:last-child td { border-bottom: 0; }
        pre { margin: 0; white-space: pre-wrap; word-break: break-word; font: inherit; color: #344054; }
    </style>
</head>
<body>
    <main>
        <h1>留言管理</h1>
        <p>最近 ${messages.length} 条留言</p>
        <div class="table-wrap">
            <table>
                <thead><tr><th>ID</th><th>姓名</th><th>留言内容</th><th>提交时间</th></tr></thead>
                <tbody>${rows || '<tr><td colspan="4">暂无留言</td></tr>'}</tbody>
            </table>
        </div>
    </main>
</body>
</html>`;
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(body);
}

function serveIndex(response) {
    fs.readFile(path.join(ROOT_DIR, 'index.html'), (error, content) => {
        if (error) {
            sendJson(response, 500, { error: '主页加载失败' });
            return;
        }

        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(content);
    });
}

function readRequestBody(request) {
    return new Promise((resolve, reject) => {
        let body = '';

        request.setEncoding('utf8');
        request.on('data', chunk => {
            body += chunk;
            if (body.length > 100 * 1024) {
                reject(new Error('请求内容过大'));
                request.destroy();
            }
        });
        request.on('end', () => resolve(body));
        request.on('error', reject);
    });
}

async function handleRequest(request, response) {
    if (request.method === 'OPTIONS') {
        response.writeHead(204, {
            'Access-Control-Allow-Origin': FRONTEND_ORIGIN,
            'Vary': 'Origin',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        response.end();
        return;
    }

    if (request.method === 'GET' && ['/api/messages', '/api/mess'].includes(request.url)) {
        if (!ADMIN_TOKEN || !hasBasicAdminAccess(request)) {
            response.writeHead(401, {
                'Content-Type': 'application/json; charset=utf-8',
                'WWW-Authenticate': 'Basic realm="message-admin"',
                'Cache-Control': 'no-store'
            });
            response.end(JSON.stringify({ error: '需要后台登录' }));
            return;
        }

        sendMessagesTable(response, await getMessages());
        return;
    }

    if (request.method === 'GET' && request.url === '/api/admin/messages') {
        const authorization = request.headers.authorization || '';
        if (!ADMIN_TOKEN || authorization !== `Bearer ${ADMIN_TOKEN}`) {
            sendJson(response, 401, { error: '未授权' });
            return;
        }

        sendJson(response, 200, await getMessages());
        return;
    }

    if (request.method === 'POST' && request.url === '/api/messages') {
        try {
            const body = JSON.parse(await readRequestBody(request));
            const name = String(body.name || '').trim();
            const content = String(body.content || '').trim();

            if (!name || !content) {
                sendJson(response, 400, { error: '姓名和留言内容不能为空' });
                return;
            }
            if (name.length > 50 || content.length > 5000) {
                sendJson(response, 400, { error: '姓名或留言内容超过长度限制' });
                return;
            }

            const id = await saveMessage(name, content);
            sendJson(response, 201, {
                id,
                message: '留言提交成功'
            });
        } catch (error) {
            const isBadJson = error instanceof SyntaxError;
            sendJson(response, isBadJson ? 400 : 500, {
                error: isBadJson ? '请求格式不正确' : '留言保存失败'
            });
        }
        return;
    }

    if (request.method === 'GET' && (request.url === '/' || request.url === '/index.html')) {
        serveIndex(response);
        return;
    }

    sendJson(response, 404, { error: '接口不存在' });
}

const server = http.createServer((request, response) => {
    handleRequest(request, response).catch(() => {
        if (!response.headersSent) sendJson(response, 500, { error: '服务器内部错误' });
    });
});

async function start() {
    await initializeDatabase();
    server.listen(PORT, () => {
        console.log(`留言板已启动：http://localhost:${PORT}`);
        console.log(`数据库：${usePostgres ? 'Render PostgreSQL' : DATABASE_FILE}`);
    });
}

function closeServer() {
    const closeDatabase = pool ? pool.end() : Promise.resolve(database?.close());
    closeDatabase.finally(() => server.close(() => process.exit(0)));
}

process.on('SIGINT', closeServer);
process.on('SIGTERM', closeServer);
start().catch(error => {
    console.error('数据库初始化失败：', error.message);
    process.exit(1);
});