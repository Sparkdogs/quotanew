# Vercel 部署说明

这个项目已经适配 Vercel：

- 静态页面位于 `public/`
- Vercel Function 入口位于 `api/index.js`
- 本地启动入口是 `server.js`
- 本地数据写入 `data/db.json`
- Vercel 数据写入 Vercel Blob

## 1. 创建 Vercel Blob

在 Vercel 项目的 Storage 页面创建 Blob 存储，建议选择 Private Blob。创建并连接到项目后，Vercel 会提供 `BLOB_READ_WRITE_TOKEN` 环境变量。

如果使用 Vercel CLI，也可以创建 Blob store 并把 token 加到项目环境变量。

## 2. 配置环境变量

Vercel 项目需要配置：

```text
BLOB_READ_WRITE_TOKEN=你的 Vercel Blob 读写 token
SESSION_SECRET=一段足够长的随机字符串
```

可选：

```text
DB_BLOB_PATH=quota-query-system/db.json
```

`DB_BLOB_PATH` 不配置时会使用默认路径 `quota-query-system/db.json`。

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

如果你希望把本地 `data/db.json` 里的账号和配额作为线上初始数据，先在本地安装依赖并配置 `BLOB_READ_WRITE_TOKEN`，然后运行：

```bash
npm run upload-db
```

这会把本地 `data/db.json` 上传到 Vercel Blob 的 `quota-query-system/db.json` 路径。若设置了 `DB_BLOB_PATH`，会上传到你指定的路径。

## 注意

不要在 Vercel 上依赖 `data/db.json` 保存生产数据。Vercel Functions 的文件系统不能作为持久数据库使用；本项目在检测到 `BLOB_READ_WRITE_TOKEN` 后会使用 Vercel Blob 持久保存数据。
