const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const PORT = Number(process.env.PORT) || 3000;
const ROOT_DIR = __dirname;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '*';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || '';
const usePostgres = Boolean(process.env.DATABASE_URL);
const isRenderEnvironment = Boolean(
    process.env.RENDER ||
    process.env.RENDER_SERVICE_ID ||
    process.env.RENDER_EXTERNAL_URL
);
const DATA_DIR = path.join(ROOT_DIR, 'data');
const DATABASE_FILE = path.join(DATA_DIR, 'messages.db');

let database;
let pool;
let legacyNameColumn = false;
let postgresMessageColumns = new Set();

async function initializeDatabase() {
    if (!usePostgres && isRenderEnvironment) {
        throw new Error('Render 环境必须配置 DATABASE_URL，不能使用临时 SQLite 存储留言');
    }

    if (usePostgres) {
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false }
        });
        await pool.query(`
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                company_name TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);
        // 健壮迁移：兼容历史遗留表。先确认 name 列是否存在再回填，
        // 否则纯 company_name 结构的新表会因引用不存在的列而启动失败。
        const { rows: legacyNameRows } = await pool.query(`
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'messages' AND column_name = 'name'
        `);
        const hasLegacyNameColumn = legacyNameRows.length > 0;
        await pool.query('ALTER TABLE messages ADD COLUMN IF NOT EXISTS company_name TEXT');
        if (hasLegacyNameColumn) {
            await pool.query('UPDATE messages SET company_name = name WHERE company_name IS NULL AND name IS NOT NULL');
        }
        await pool.query("UPDATE messages SET company_name = '未知' WHERE company_name IS NULL");
        await pool.query('ALTER TABLE messages ALTER COLUMN company_name SET NOT NULL');
        const currentColumns = await pool.query(`
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'messages' AND column_name IN ('name', 'company_name')
        `);
        postgresMessageColumns = new Set(currentColumns.rows.map(row => row.column_name));
        legacyNameColumn = postgresMessageColumns.has('name');
        return;
    }

    fs.mkdirSync(DATA_DIR, { recursive: true });
    const { DatabaseSync } = require('node:sqlite');
    database = new DatabaseSync(DATABASE_FILE);
    database.exec(`
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_name TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);
    const columns = database.prepare('PRAGMA table_info(messages)').all();
    const hasCompanyName = columns.some(column => column.name === 'company_name');
    const hasLegacyName = columns.some(column => column.name === 'name');
    legacyNameColumn = hasLegacyName;
    if (hasLegacyName && !hasCompanyName) {
        database.exec('ALTER TABLE messages ADD COLUMN company_name TEXT');
        database.exec('UPDATE messages SET company_name = name WHERE company_name IS NULL');
    }
}

async function getMessages() {
    if (usePostgres) {
        const result = await pool.query(`
            SELECT id, company_name, content, created_at
            FROM messages
            ORDER BY id DESC
        `);
        return result.rows;
    }

    return database.prepare(`
        SELECT id, company_name, content, created_at
        FROM messages
        ORDER BY id DESC
    `).all();
}

async function saveMessage(companyName, content) {
    if (usePostgres) {
        // 动态 INSERT：根据当前实际表结构构建，兼容任意历史改造过的表。
        // 有 name 列时同步写入，保证历史兼容查询仍可用。
        const { rows: columns } = await pool.query(`
            SELECT column_name, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = 'messages'
            ORDER BY ordinal_position
        `);

        const insertColumns = [];
        const insertValues = [];
        for (const column of columns) {
            if (column.column_name === 'id') continue;
            if (column.column_name === 'company_name' || column.column_name === 'name') {
                insertColumns.push(column.column_name);
                insertValues.push(companyName);
                continue;
            }
            if (column.column_name === 'content') {
                insertColumns.push(column.column_name);
                insertValues.push(content);
                continue;
            }
            // 未识别的列：仅当必填且无默认值时干预，否则交给数据库默认值填
            if (column.is_nullable === 'NO' && !column.column_default) {
                throw new Error(`messages 表存在未知必填字段：${column.column_name}，请人工处理`);
            }
        }

        const placeholders = insertValues.map((_, index) => `$${index + 1}`).join(', ');
        const result = await pool.query(
            `INSERT INTO messages (${insertColumns.join(', ')})
             VALUES (${placeholders}) RETURNING id`,
            insertValues
        );
        return result.rows[0].id;
    }

    if (legacyNameColumn) {
        const result = database.prepare(
            'INSERT INTO messages (name, company_name, content) VALUES (?, ?, ?)'
        ).run(companyName, companyName, content);
        return Number(result.lastInsertRowid);
    }
    const result = database.prepare(
        'INSERT INTO messages (company_name, content) VALUES (?, ?)'
    ).run(companyName, content);
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

function getRequestPath(request) {
    try {
        const pathname = new URL(request.url, 'http://localhost').pathname;
        return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
    } catch {
        return request.url;
    }
}

// 浏览器地址栏访问会带 text/html（此时渲染表格页）；前端 fetch / curl 默认是 */*（继续返回 JSON）。
function wantsHtml(request) {
    const accept = String(request.headers.accept || '').toLowerCase();
    return accept.includes('text/html') || accept.includes('application/xhtml+xml');
}

function formatTimestamp(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value ?? '');
    return date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

function hasBasicAdminAccess(request) {
    const authorization = request.headers.authorization || '';
    if (!authorization.startsWith('Basic ')) return false;

    const credentials = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
    const separator = credentials.indexOf(':');
    if (separator < 0) return false;

    const user = credentials.slice(0, separator);
    const pass = credentials.slice(separator + 1);
    return Boolean(ADMIN_PASS) && user === ADMIN_USER && pass === ADMIN_PASS;
}

const ADMIN_PAGE_STYLE = `
        :root { color-scheme: light; }
        body { margin: 0; padding: 32px; color: #222; background: #f4f6f8; font: 14px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
        main { max-width: 1200px; margin: 0 auto; }
        h1 { margin: 0; font-size: 22px; }
        p { color: #667085; margin: 0; }
        .toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; margin: 16px 0; }
        .toolbar .stats { margin-right: auto; color: #475467; }
        .btn { display: inline-block; padding: 7px 14px; color: #344054; background: #fff; border: 1px solid #d0d5dd; border-radius: 8px; text-decoration: none; font-size: 13px; }
        .btn:hover { background: #f9fafb; }
        .table-wrap { overflow-x: auto; background: #fff; border: 1px solid #dfe3e8; border-radius: 10px; box-shadow: 0 4px 16px rgba(16, 24, 40, .06); }
        table { width: 100%; border-collapse: collapse; min-width: 720px; }
        th, td { padding: 14px 16px; text-align: left; vertical-align: top; border-bottom: 1px solid #eaecf0; }
        th { color: #344054; background: #f9fafb; font-weight: 600; white-space: nowrap; }
        td:nth-child(1) { color: #98a2b3; }
        td:nth-child(4) { color: #667085; white-space: nowrap; }
        tbody tr:hover { background: #fcfcfd; }
        tbody tr:last-child td { border-bottom: 0; }
        pre { margin: 0; white-space: pre-wrap; word-break: break-word; font: inherit; color: #344054; }
        .empty { padding: 40px; text-align: center; color: #98a2b3; }
        .notice { max-width: 680px; padding: 28px 32px; background: #fff; border: 1px solid #dfe3e8; border-radius: 12px; }
        .notice h1 { margin-bottom: 12px; }
        .notice p { line-height: 1.8; }
        .notice.error h1 { color: #b42318; }
        code { padding: 2px 6px; background: #f2f4f7; border-radius: 6px; font-size: 13px; }
`;

function sendAdminPage(response, statusCode, title, contentHtml, extraHeaders = {}) {
    const body = `<!doctype html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <style>${ADMIN_PAGE_STYLE}</style>
</head>
<body>
    <main>
${contentHtml}
    </main>
</body>
</html>`;
    response.writeHead(statusCode, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        ...extraHeaders
    });
    response.end(body);
}

function sendMessagesTable(response, messages) {
    const rows = messages.map(message => `        <tr>
            <td>${escapeHtml(message.id)}</td>
            <td>${escapeHtml(message.company_name)}</td>
            <td><pre>${escapeHtml(message.content)}</pre></td>
            <td>${escapeHtml(formatTimestamp(message.created_at))}</td>
        </tr>`).join('\n');

    const content = `        <h1>留言管理</h1>
        <div class="toolbar">
            <span class="stats">共 ${messages.length} 条留言 · 按提交时间倒序</span>
            <a class="btn" href="/admin">刷新</a>
            <a class="btn" href="/">返回主页</a>
        </div>
        <div class="table-wrap">
            <table>
                <thead><tr><th>ID</th><th>公司名</th><th>留言内容</th><th>提交时间</th></tr></thead>
                <tbody>
${rows || '            <tr><td class="empty" colspan="4">暂无留言</td></tr>'}
                </tbody>
            </table>
        </div>`;

    sendAdminPage(response, 200, '留言管理 · 个人主页后台', content);
}

// 未认证时必须给出 HTML 401，浏览器才会弹出登录框并在通过后渲染表格。
function sendAdminLoginChallenge(response, wrongCredentials = false) {
    const hint = wrongCredentials
        ? `用户名默认 <code>${escapeHtml(ADMIN_USER)}</code>，密码为 Render 环境变量 <code>ADMIN_PASS</code> 的值。`
        : `在弹出的登录框中输入用户名 <code>${escapeHtml(ADMIN_USER)}</code> 和 <code>ADMIN_PASS</code> 密码，即可查看留言表格。`;
    const notConfigured = ADMIN_PASS
        ? ''
        : `<p><strong>注意：</strong>当前服务未检测到 <code>ADMIN_PASS</code> 环境变量，任何密码都无法通过校验。请在 Render 服务的 Environment 中配置 <code>ADMIN_PASS</code> 后重新部署。</p>`;

    const content = `        <div class="notice${wrongCredentials ? ' error' : ''}">
            <h1>${wrongCredentials ? '账号或密码错误' : '需要登录'}</h1>
            <p>留言板后台需要 Basic 认证。${hint}</p>
            ${notConfigured}
            <p><a class="btn" href="/">返回主页</a></p>
        </div>`;

    sendAdminPage(
        response,
        401,
        wrongCredentials ? '登录失败' : '留言后台登录',
        content,
        wrongCredentials ? {} : { 'WWW-Authenticate': 'Basic realm="message-admin"' }
    );
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
    const pathname = getRequestPath(request);

    if (request.method === 'GET' && pathname === '/health') {
        sendJson(response, 200, { ok: true });
        return;
    }

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

    // 后台 JSON 数据（供程序调用）
    if (request.method === 'GET' && pathname === '/api/admin/messages') {
        if (!hasBasicAdminAccess(request)) {
            if (wantsHtml(request)) {
                sendAdminLoginChallenge(response, (request.headers.authorization || '').startsWith('Basic '));
                return;
            }
            response.writeHead(401, {
                'Content-Type': 'application/json; charset=utf-8',
                'WWW-Authenticate': 'Basic realm="message-admin"',
                'Cache-Control': 'no-store'
            });
            response.end(JSON.stringify({ error: '未授权' }));
            return;
        }

        sendJson(response, 200, await getMessages());
        return;
    }

    // 留言数据入口：带认证或浏览器地址栏访问 → 渲染 HTML 表格页；前端 fetch → JSON
    if (request.method === 'GET' && ['/admin', '/api/messages', '/api/mess'].includes(pathname)) {
        const sentCredentials = (request.headers.authorization || '').startsWith('Basic ');

        if (sentCredentials) {
            if (!hasBasicAdminAccess(request)) {
                if (wantsHtml(request)) {
                    sendAdminLoginChallenge(response, true);
                    return;
                }
                response.writeHead(401, {
                    'Content-Type': 'application/json; charset=utf-8',
                    'WWW-Authenticate': 'Basic realm="message-admin"',
                    'Cache-Control': 'no-store'
                });
                response.end(JSON.stringify({ error: '账号密码错误' }));
                return;
            }

            sendMessagesTable(response, await getMessages());
            return;
        }

        if (pathname === '/admin' || wantsHtml(request)) {
            sendAdminLoginChallenge(response, false);
            return;
        }

        sendJson(response, 200, await getMessages());
        return;
    }

    if (request.method === 'POST' && pathname === '/api/messages') {
        try {
            const body = JSON.parse(await readRequestBody(request));
            const companyName = String(body.companyName || body.company || body.name || '').trim();
            const content = String(body.content || '').trim();

            if (!companyName || !content) {
                sendJson(response, 400, { error: '公司名和留言内容不能为空' });
                return;
            }
            if (companyName.length > 100 || content.length > 5000) {
                sendJson(response, 400, { error: '公司名或留言内容超过长度限制' });
                return;
            }

            const id = await saveMessage(companyName, content);
            sendJson(response, 201, {
                id,
                message: '留言提交成功'
            });
        } catch (error) {
            const isBadJson = error instanceof SyntaxError;
            if (!isBadJson) console.error('保存留言失败：', error);
            sendJson(response, isBadJson ? 400 : 500, {
                error: isBadJson ? '请求格式不正确' : '留言保存失败'
            });
        }
        return;
    }

    if (request.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
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