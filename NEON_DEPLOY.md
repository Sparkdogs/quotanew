# 使用 Neon 部署到 Vercel

## 1. 推送代码到 GitHub

```bash
git add .
git commit -m "Use Neon for persistent storage"
git push
```

## 2. 在 Vercel 导入 GitHub 仓库

1. 打开 Vercel Dashboard
2. `Add New...` -> `Project`
3. 选择 GitHub 仓库
4. Framework Preset 选择 `Other`
5. Build Command 留空
6. Output Directory 留空

## 3. 创建并连接 Neon

推荐在 Vercel 项目里通过 Marketplace / Storage 添加 Neon Postgres。连接当前项目后，Vercel 会自动注入：

```text
DATABASE_URL
```

如果没有自动出现，请在 Neon 控制台复制连接字符串，然后到 Vercel 项目：

```text
Settings -> Environment Variables
```

手动添加：

```text
DATABASE_URL=你的 Neon 连接字符串
```

## 4. 配置会话密钥

在 Vercel 项目环境变量里添加：

```text
SESSION_SECRET=一段足够长的随机字符串
```

## 5. 可选：指定数据 key

默认使用：

```text
DB_STATE_KEY=quota-query-system
```

你可以不配置。若想强制线上从空数据开始，可以配置一个从未用过的新 key：

```text
DB_STATE_KEY=quota-query-system-fresh-20260529
```

## 6. 部署

点击 Deploy。部署后先访问：

```text
https://你的项目域名.vercel.app/api/ping
```

如果返回：

```json
{"ok":true,"service":"quota-query-system"}
```

说明 Vercel Functions 已经正确部署。然后再访问：

```text
https://你的项目域名.vercel.app/api/setup-status
```

如果返回：

```json
{"needsSetup":true}
```

说明 Neon 里还没有用户，首页会进入“创建超级管理员”。

如果返回：

```json
{"needsSetup":false}
```

说明当前 `DB_STATE_KEY` 对应的数据里已经有用户。可以换一个新的 `DB_STATE_KEY` 后重新部署。

如果 `/api/ping` 返回的是 HTML 页面，说明 Vercel 没有部署到最新代码，或项目设置错误。重点检查：

- GitHub 最新提交里是否有 `api/ping.js`
- Vercel 是否部署了最新 commit
- Framework Preset 是否为 `Other`
- Output Directory 是否为空
- Root Directory 是否是项目根目录
- `vercel.json` 是否包含 `"handle": "filesystem"`

## 7. 迁移本地数据到 Neon

如果你想把本地 `data/db.json` 上传到 Neon：

```bash
DATABASE_URL="你的 Neon 连接字符串" npm run upload-db:neon
```

如果指定了 `DB_STATE_KEY`，上传时也要带上同一个值：

```bash
DATABASE_URL="你的 Neon 连接字符串" DB_STATE_KEY="quota-query-system" npm run upload-db:neon
```

如果你想让线上首次创建超级管理员，不要执行上传脚本。
