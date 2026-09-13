# DHD 预约系统 · 公网部署手册

这套系统是 "Node.js 后端 + SQLite 数据库 + 浏览器前端"，前端调相对路径 `/api`，
带实时推送（socket.io）。要公网访问，必须部署到**能常驻运行 Node 进程 + 有持久磁盘**的服务器上。

---

## 最省事的方案：Render（免费，推荐）

### 为什么选 Render
- ✅ 免费 Web Service，可常驻运行 `node server.js`
- ✅ 有**持久化磁盘** → SQLite 数据库存到 `/data`，不会因重启/重部署丢失
- ✅ 原生模块 `better-sqlite3` 能正常编译
- ⚠️ **不建议用 Vercel**：它的"无服务器函数"每次请求才启动，撑不住 socket.io 长连接，数据也会丢

### 前置条件
1. 一个 GitHub 账号
2. 一个 Render 账号（[render.com](https://render.com) 注册，可用 GitHub 授权登录）

### 操作步骤（一次配置，之后自动更新）

#### 第 1 步：把项目推送到 GitHub
在本地项目目录打开终端，执行：

```
git init
git add .
git commit -m "init"
git branch -M main
git remote add origin https://github.com/gccmc/DineQueue.git
git push -u origin main
```

> （如果还没配 GitHub 凭据，用 `gh auth login` 或按 GitHub 提示操作）

#### 第 2 步：Render 连接仓库一键部署
1. 登录 Render → 点 **New** → 选 **Blueprint**
2. 选择你刚 push 的 GitHub 仓库
3. Render 会自动读取仓库里的 `render.yaml`，识别出 Web Service + 磁盘，点击 **Apply / Deploy**
4. 等几分钟，部署完成后 Render 会给你一个公网域名（形如 `https://dhd-xxxx.onrender.com`）

部署好后直接访问这个域名即可，**五端共用同一个地址**：

| 页面 | 地址 |
|---|---|
| 预约平台 | `https://你的域名/` （或 `/index.html`） |
| 自助取号机 | `你的域名/kiosk.html` |
| 叫号大屏 | `你的域名/display.html` |
| 后台管理 | `你的域名/admin.html` |
| 到店确认台 | `你的域名/confirm.html` |

#### 第 3 步（可选）绑定自定义域名
Render 免费版也支持绑定自定义域名：Web Service → Settings → Custom Domain，填你买的域名并做 CNAME 解析。

---

## 数据持久化原理（重要）

- 云端数据库写在挂载磁盘 `/data/data.db`，由 `render.yaml` 里配置的
  `DATA_DIR=/data` 环境变量指定。
- `server.js` 逻辑：`DATA_DIR` 存在就用它，否则本地默认项目根目录。所以本地跑不受影响。
- 下次重部署/重启，数据仍在磁盘上。

---

## 日常更新代码（半自动）

只改代码、不用重新配置：
```
git add .
git commit -m "更新内容"
git push
```
Render 检测到 push 会自动重新部署。改数据库表（新增字段）也不会丢已有数据。

---

## 本地运行（不部署时）

```
npm install
node server.js
```
然后访问 `http://localhost:3000`。

---

## 常见问题

- **数据库在哪 / 会不会丢**：云端在磁盘 `/data/data.db`，持久化，不会丢。
- **大屏不实时刷新**：确认浏览器能访问到 socket.io（页面会自动连），网络正常即可。
- **`better-sqlite3` 编译失败**：Render 的 Node 环境一般没问题；若失败，在部署页 Environment 里切换到 Node 18 LTS。
- **确认机/取号机摄像头打不开**：局域网 HTTP 下浏览器会拦截摄像头。Windows 门店设备可双击运行项目根目录的 `confirm-machine.bat` 启动浏览器。
- **后台/后台没有密码**：目前是开放访问。正式对外建议后续加一层登录校验（可告诉我帮你加上）。