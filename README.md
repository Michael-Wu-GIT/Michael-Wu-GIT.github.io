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

- `POST /api/messages`：保存姓名和留言内容
- `GET /api/messages`：后台 HTML 表格，需要 Basic Auth（用户名 `admin`，密码为 `ADMIN_TOKEN`）
- `GET /api/admin/messages`：后台 JSON 数据，需要 `Authorization: Bearer <ADMIN_TOKEN>`

停止服务：在终端按 `Ctrl + C`。

## Render 部署

在 Render Web Service `srv-dahcn7ijnfac738epcq0` 中设置：

- Build Command：`npm install`
- Start Command：`npm start`
- `DATABASE_URL`：绑定 Render PostgreSQL 的 Internal Database URL
- `FRONTEND_ORIGIN`：GitHub Pages 地址，例如 `https://michael-wu-git.github.io`
- `ADMIN_TOKEN`：后台查询留言的随机密钥

当前 Render API 公开地址：<https://message-api-9j19.onrender.com>

部署完成后，推送 `index.html` 到 GitHub Pages 即可生效。
