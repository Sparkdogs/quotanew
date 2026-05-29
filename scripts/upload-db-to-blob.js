import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { put } from "@vercel/blob";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const dbFile = path.join(rootDir, "data", "db.json");
const blobPath = process.env.DB_BLOB_PATH || "quota-query-system/db.json";

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error("缺少 BLOB_READ_WRITE_TOKEN 环境变量");
  process.exit(1);
}

if (!fs.existsSync(dbFile)) {
  console.error(`未找到本地数据文件：${dbFile}`);
  process.exit(1);
}

const content = fs.readFileSync(dbFile, "utf8");
JSON.parse(content);

await put(blobPath, content, {
  access: "private",
  allowOverwrite: true,
  contentType: "application/json",
  cacheControlMaxAge: 60
});

console.log(`已上传 ${dbFile} 到 Vercel Blob：${blobPath}`);
