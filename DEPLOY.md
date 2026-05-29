# Vercel 部署说明

这个项目已经适配 Vercel + Neon：

- 静态页面位于 `public/`
- Vercel Function 入口位于 `api/index.js`
- 本地启动入口是 `server.js`
- 本地数据写入 `data/db.json`
- Vercel 数据优先写入 Neon Postgres
- 如果没有 `DATABASE_URL` 但配置了 `BLOB_READ_WRITE_TOKEN`，会兼容写入 Vercel Blob

## 1. 创建 Neon 数据库

推荐在 Vercel 项目的 Storage / Marketplace 里创建 Neon Postgres，并连接到当前项目。连接后，Vercel 会自动给项目注入 `DATABASE_URL`。

本项目会自动创建一张表：

```sql
CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

系统用户和配额数据会保存在 `app_state.data` 这个 JSONB 字段里。

## 2. 配置环境变量

Vercel 项目需要配置：

```text
DATABASE_URL=你的 Neon 连接字符串
SESSION_SECRET=一段足够长的随机字符串
```

可选：

```text
DB_STATE_KEY=quota-query-system
```

`DB_STATE_KEY` 不配置时会使用默认 key `quota-query-system`。如果你想重置线上数据但不删除 Neon 表，可以换一个新的 key，例如：

```text
DB_STATE_KEY=quota-query-system-fresh-20260529
```

## 3. 部署

如果本机安装了 Vercel CLI：

```bash
vercel deploy
```

生产部署：

```bash
vercel deploy --prod
```

也可以把这个目录提交到 GitHub，然后在 Vercel 导入仓库。Vercel 会自动安装 `package.json` 里的依赖并部署。

## 4. 首次访问

部署完成后，首次打开站点会进入“创建超级管理员”页面。这个账号只会在首次初始化时创建，后续管理员和用户由超级管理员维护。

## 5. 迁移本地数据到线上

如果你希望把本地 `data/db.json` 里的账号和配额作为线上初始数据，先在本地安装依赖并配置 `DATABASE_URL`，然后运行：

```bash
npm run upload-db:neon
```

这会把本地 `data/db.json` 上传到 Neon 的 `app_state` 表。若设置了 `DB_STATE_KEY`，会上传到你指定的 key。

如果你仍然想使用 Vercel Blob，也可以配置 `BLOB_READ_WRITE_TOKEN` 并运行：

```bash
npm run upload-db:blob
```

## 注意

不要在 Vercel 上依赖 `data/db.json` 保存生产数据。Vercel Functions 的文件系统不能作为持久数据库使用；本项目在检测到 `DATABASE_URL` 后会使用 Neon 持久保存数据。
