# Michael-Wu-GIT.github.io

吴永毅个人主页，包含 GitHub Pages + Render API + PostgreSQL 留言板。

## 项目结构

```text
.
├── index.html       # 个人主页与留言表单
├── server.js        # HTTP API、静态页面服务、PostgreSQL/SQLite 数据库初始化
├── package.json     # 启动命令与 Node.js 版本要求
├── data/
│   └── messages.db  # 无 DATABASE_URL 时本地开发自动生成，不提交到 Git
└── README.md
```

## 启动步骤

要求 Node.js `22.5.0` 或更高版本。

```bash
# 进入项目目录
cd "/Users/apple/Desktop/菲科/99 个人主页/Michael-Wu-GIT.github.io"

# 启动本地后端和网页
npm start
```

浏览器打开：<http://localhost:3000>

本地没有设置 `DATABASE_URL` 时，会自动创建 `data/messages.db`。Render 部署时设置 `DATABASE_URL` 后，会自动使用 Render PostgreSQL。留言表单通过以下接口读写数据库：

- `POST /api/messages`：保存公司名和留言内容（兼容旧版 `name` 字段）
- `GET /health`：Render 服务健康检查
- `GET /admin`：后台留言表格页（浏览器可直接访问，需要 Basic Auth）
- `GET /api/messages`：浏览器地址栏访问时渲染后台表格页（需 Basic Auth）；普通 `fetch` / `curl` 调用返回留言板 JSON
- `GET /api/mess`：后台表格页别名，需要 Basic Auth
- `GET /api/admin/messages`：后台 JSON 数据，需要 Basic Auth

> 渲染规则：服务按请求的 `Accept` 头区分客户端。浏览器导航会带上 `text/html`，此时返回 HTML 表格页并在未登录时返回 `401 + WWW-Authenticate`，由浏览器弹出登录框；前端 `fetch` 与 `curl` 默认是 `*/*`，继续拿到 JSON，接口行为不变。

### 查看后台留言表格

浏览器打开 <https://message-api-o8nd.onrender.com/admin>（或 <https://message-api-o8nd.onrender.com/api/messages>）：

1. 浏览器弹出登录框，用户名默认为 `admin`，密码为 Render 环境变量 `ADMIN_PASS` 的值。
2. 登录成功后显示表格：ID / 公司名 / 留言内容 / 提交时间（北京时间，按提交时间倒序）。
3. 未配置 `ADMIN_PASS` 时页面会直接提示缺少环境变量，不会出现“显示代码”的情况。
4. 忘记密码：在 Render → 服务 → Environment 中重置 `ADMIN_PASS`，重新部署后生效。

后台留言管理以公司名为展示字段，数据来自 PostgreSQL 的 `messages` 表，按提交时间倒序展示。主页 `index.html` 目前只保留留言提交表单，不公开展示历史留言（留言内容含客户联系方式，避免公开泄露）。

停止服务：在终端按 `Ctrl + C`。

## Render 部署

在 Render Web Service `srv-dahcn7ijnfac738epcq0` 中设置：

- Build Command：`npm install`
- Start Command：`npm start`
- `DATABASE_URL`：绑定 Render PostgreSQL 的 Internal Database URL
- `FRONTEND_ORIGIN`：GitHub Pages 地址，例如 `https://michael-wu-git.github.io`
- `ADMIN_USER`：后台登录用户名，默认 `admin`
- `ADMIN_PASS`：后台登录密码，必须在 Render 中设置

`DATABASE_URL` 为必填项。Render 未配置 PostgreSQL 时服务会拒绝启动，避免使用临时磁盘导致重启后留言丢失。

当前 Render API 公开地址：<https://message-api-o8nd.onrender.com>

部署完成后，推送 `index.html` 到 GitHub Pages 即可生效。
