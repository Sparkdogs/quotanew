import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const dbFile = path.join(rootDir, "data", "db.json");
const stateKey = process.env.DB_STATE_KEY || "quota-query-system";

if (!process.env.DATABASE_URL) {
  console.error("缺少 DATABASE_URL 环境变量");
  process.exit(1);
}

if (!fs.existsSync(dbFile)) {
  console.error(`未找到本地数据文件：${dbFile}`);
  process.exit(1);
}

const content = fs.readFileSync(dbFile, "utf8");
const db = JSON.parse(content);

const sql = neon(process.env.DATABASE_URL);

await sql`
  CREATE TABLE IF NOT EXISTS app_state (
    key TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

await sql`
  INSERT INTO app_state (key, data, updated_at)
  VALUES (${stateKey}, ${JSON.stringify(db)}::jsonb, NOW())
  ON CONFLICT (key)
  DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
`;

console.log(`已上传 ${dbFile} 到 Neon app_state：${stateKey}`);
