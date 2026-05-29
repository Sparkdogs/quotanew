import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT_DIR, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DB_BLOB_PATH = process.env.DB_BLOB_PATH || "quota-query-system/db.json";
const DEFAULT_DB = { users: [], quotas: [] };

const ROLE_SUPER = "super_admin";
const ROLE_ADMIN = "admin";
const ROLE_USER = "user";
const QUOTA_FIELDS = [
  "productType",
  "serviceType",
  "name",
  "showName",
  "description",
  "englishDescription",
  "apply",
  "automaticApprovalInterval",
  "manualApprovalInterval"
];

export async function handleRequest(req, res) {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    await serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    sendJson(res, error.statusCode || 500, { error: error.statusCode ? error.message : "服务器内部错误" });
  }
}

async function handleApi(req, res, url) {
  const db = await readDb();
  const currentUser = getCurrentUser(req, db);

  if (req.method === "GET" && url.pathname === "/api/setup-status") {
    sendJson(res, 200, { needsSetup: db.users.length === 0 });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/setup") {
    if (db.users.length > 0) {
      sendJson(res, 409, { error: "超级管理员已创建" });
      return;
    }
    const body = await readJson(req);
    const username = cleanText(body.username);
    const password = String(body.password || "");
    if (!username || password.length < 6) {
      sendJson(res, 400, { error: "用户名不能为空，密码至少 6 位" });
      return;
    }
    const user = createUser(username, password, ROLE_SUPER);
    db.users.push(user);
    await writeDb(db);
    createSession(res, user.id);
    sendJson(res, 201, { user: safeUser(user) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/login") {
    const body = await readJson(req);
    const username = cleanText(body.username);
    const password = String(body.password || "");
    const user = db.users.find((item) => item.username === username);
    if (!user || !(await verifyPassword(password, user.password))) {
      sendJson(res, 401, { error: "用户名或密码错误" });
      return;
    }
    createSession(res, user.id);
    sendJson(res, 200, { user: safeUser(user) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/logout") {
    res.setHeader("Set-Cookie", "sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
    sendJson(res, 200, { ok: true });
    return;
  }

  if (!currentUser) {
    sendJson(res, 401, { error: "请先登录" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/me") {
    sendJson(res, 200, { user: safeUser(currentUser) });
    return;
  }

  if (url.pathname === "/api/users") {
    requireSuper(currentUser);
    if (req.method === "GET") {
      sendJson(res, 200, { users: db.users.map(safeUser) });
      return;
    }
    if (req.method === "POST") {
      const body = await readJson(req);
      const username = cleanText(body.username);
      const password = String(body.password || "");
      const role = String(body.role || "");
      if (!username || password.length < 6 || ![ROLE_ADMIN, ROLE_USER].includes(role)) {
        sendJson(res, 400, { error: "只能创建管理员或用户，密码至少 6 位" });
        return;
      }
      if (db.users.some((item) => item.username === username)) {
        sendJson(res, 409, { error: "用户名已存在" });
        return;
      }
      const user = createUser(username, password, role);
      db.users.push(user);
      await writeDb(db);
      sendJson(res, 201, { user: safeUser(user) });
      return;
    }
  }

  if (url.pathname.startsWith("/api/users/")) {
    requireSuper(currentUser);
    const id = decodeURIComponent(url.pathname.split("/").pop() || "");
    const user = db.users.find((item) => item.id === id);
    if (!user) {
      sendJson(res, 404, { error: "用户不存在" });
      return;
    }
    if (req.method === "PUT") {
      const body = await readJson(req);
      const username = cleanText(body.username);
      const password = String(body.password || "");
      const role = String(body.role || user.role);
      if (!username || ![ROLE_SUPER, ROLE_ADMIN, ROLE_USER].includes(role)) {
        sendJson(res, 400, { error: "用户名或角色不合法" });
        return;
      }
      if (user.role !== ROLE_SUPER && role === ROLE_SUPER) {
        sendJson(res, 400, { error: "超级管理员只能在首次访问时创建" });
        return;
      }
      if (db.users.some((item) => item.id !== id && item.username === username)) {
        sendJson(res, 409, { error: "用户名已存在" });
        return;
      }
      if (user.role === ROLE_SUPER && role !== ROLE_SUPER && countSuperUsers(db) === 1) {
        sendJson(res, 400, { error: "至少保留一个超级管理员" });
        return;
      }
      user.username = username;
      user.role = role;
      if (password) {
        if (password.length < 6) {
          sendJson(res, 400, { error: "新密码至少 6 位" });
          return;
        }
        user.password = await hashPassword(password);
      }
      user.updatedAt = new Date().toISOString();
      await writeDb(db);
      sendJson(res, 200, { user: safeUser(user) });
      return;
    }
  }

  if (req.method === "GET" && url.pathname === "/api/quotas") {
    const query = cleanText(url.searchParams.get("q")).toLowerCase();
    const quotas = query
      ? db.quotas.filter((quota) => fuzzyQuota(quota, query))
      : db.quotas;
    sendJson(res, 200, { quotas });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/quotas") {
    requireEditor(currentUser);
    const quota = normalizeQuota(await readJson(req));
    const error = validateQuota(quota);
    if (error) {
      sendJson(res, 400, { error });
      return;
    }
    if (db.quotas.some((item) => item.name === quota.name)) {
      sendJson(res, 409, { error: "配额名称已存在" });
      return;
    }
    quota.id = crypto.randomUUID();
    quota.createdAt = new Date().toISOString();
    quota.updatedAt = quota.createdAt;
    db.quotas.push(quota);
    await writeDb(db);
    sendJson(res, 201, { quota });
    return;
  }

  if (url.pathname.startsWith("/api/quotas/")) {
    requireEditor(currentUser);
    const id = decodeURIComponent(url.pathname.split("/").pop() || "");
    const index = db.quotas.findIndex((item) => item.id === id);
    if (index === -1) {
      sendJson(res, 404, { error: "配额不存在" });
      return;
    }
    if (req.method === "PUT") {
      const quota = normalizeQuota(await readJson(req));
      const error = validateQuota(quota);
      if (error) {
        sendJson(res, 400, { error });
        return;
      }
      if (db.quotas.some((item) => item.id !== id && item.name === quota.name)) {
        sendJson(res, 409, { error: "配额名称已存在" });
        return;
      }
      db.quotas[index] = {
        ...db.quotas[index],
        ...quota,
        id,
        updatedAt: new Date().toISOString()
      };
      await writeDb(db);
      sendJson(res, 200, { quota: db.quotas[index] });
      return;
    }
    if (req.method === "DELETE") {
      db.quotas.splice(index, 1);
      await writeDb(db);
      sendJson(res, 200, { ok: true });
      return;
    }
  }

  if (req.method === "POST" && url.pathname === "/api/import") {
    requireEditor(currentUser);
    const filename = decodeURIComponent(String(req.headers["x-file-name"] || ""));
    const mode = String(req.headers["x-import-mode"] || "merge");
    const buffer = await readBuffer(req);
    const imported = parseQuotaFile(filename, buffer);
    const normalized = dedupeImportedQuotas(imported).map((item) => ({
      ...normalizeQuota(item),
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }));
    const invalidIndex = normalized.findIndex((item) => validateQuota(item));
    if (invalidIndex !== -1) {
      sendJson(res, 400, { error: `第 ${invalidIndex + 2} 行存在必填项为空` });
      return;
    }
    if (mode === "replace") {
      db.quotas = normalized;
    } else {
      const byName = new Map(db.quotas.map((quota) => [quota.name, quota]));
      for (const quota of normalized) {
        const existing = byName.get(quota.name);
        if (existing) {
          Object.assign(existing, quota, { id: existing.id, updatedAt: new Date().toISOString() });
        } else {
          db.quotas.push(quota);
        }
      }
    }
    await writeDb(db);
    sendJson(res, 200, { imported: normalized.length, total: db.quotas.length });
    return;
  }

  sendJson(res, 404, { error: "接口不存在" });
}

async function readDb() {
  if (useBlobStorage()) {
    try {
      const { get } = await import("@vercel/blob");
      const result = await get(DB_BLOB_PATH, { access: "private" });
      if (!result) return structuredClone(DEFAULT_DB);
      const text = await blobResultToText(result);
      return JSON.parse(text);
    } catch (error) {
      if (String(error?.message || "").includes("not exist") || String(error?.name || "").includes("NotFound")) {
        return structuredClone(DEFAULT_DB);
      }
      throw error;
    }
  }
  if (process.env.VERCEL) {
    throw new Error("缺少 BLOB_READ_WRITE_TOKEN 环境变量，Vercel 部署需要绑定 Blob 存储");
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_DB, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

async function writeDb(db) {
  if (useBlobStorage()) {
    const { put } = await import("@vercel/blob");
    await put(DB_BLOB_PATH, JSON.stringify(db, null, 2), {
      access: "private",
      allowOverwrite: true,
      contentType: "application/json",
      cacheControlMaxAge: 60
    });
    return;
  }
  if (process.env.VERCEL) {
    throw new Error("缺少 BLOB_READ_WRITE_TOKEN 环境变量，Vercel 部署需要绑定 Blob 存储");
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function useBlobStorage() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

async function blobResultToText(result) {
  if (typeof result.text === "function") return result.text();
  if (result.body && typeof result.body.getReader === "function") return streamToText(result.body);
  if (result.stream && typeof result.stream.getReader === "function") return streamToText(result.stream);
  if (result.arrayBuffer) return Buffer.from(await result.arrayBuffer()).toString("utf8");
  throw new Error("无法读取 Blob 数据");
}

async function streamToText(stream) {
  const reader = stream.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function createUser(username, password, role) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return {
    id: crypto.randomUUID(),
    username,
    password: `${salt}:${hash}`,
    role,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, key) => error ? reject(error) : resolve(key.toString("hex")));
  });
  return `${salt}:${hash}`;
}

async function verifyPassword(password, stored) {
  if (!stored.includes(":")) return false;
  const [salt, hash] = stored.split(":");
  const actual = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, key) => error ? reject(error) : resolve(key.toString("hex")));
  });
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(actual, "hex"));
}

function safeUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

function createSession(res, userId) {
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ userId, expiresAt })).toString("base64url");
  const signature = signSession(payload);
  const secure = process.env.VERCEL ? "; Secure" : "";
  res.setHeader("Set-Cookie", `sid=${payload}.${signature}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secure}`);
}

function getCurrentUser(req, db) {
  try {
    const sid = readCookie(req, "sid");
    if (!sid || !sid.includes(".")) return null;
    const [payload, signature] = sid.split(".");
    if (signature !== signSession(payload)) return null;
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!session.userId || Date.now() > Number(session.expiresAt)) return null;
    return db.users.find((user) => user.id === session.userId) || null;
  } catch {
    return null;
  }
}

function signSession(payload) {
  return crypto
    .createHmac("sha256", sessionSecret())
    .update(payload)
    .digest("base64url");
}

function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (process.env.VERCEL) {
    throw new Error("缺少 SESSION_SECRET 环境变量");
  }
  return "local-development-session-secret";
}

function readCookie(req, name) {
  const cookie = req.headers.cookie || "";
  const part = cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : "";
}

function requireSuper(user) {
  if (user.role !== ROLE_SUPER) {
    const error = new Error("需要超级管理员权限");
    error.statusCode = 403;
    throw error;
  }
}

function requireEditor(user) {
  if (![ROLE_SUPER, ROLE_ADMIN].includes(user.role)) {
    const error = new Error("需要管理员权限");
    error.statusCode = 403;
    throw error;
  }
}

function countSuperUsers(db) {
  return db.users.filter((user) => user.role === ROLE_SUPER).length;
}

function normalizeQuota(input) {
  const quota = {};
  for (const field of QUOTA_FIELDS) {
    quota[field] = cleanText(input[field]);
  }
  return quota;
}

function validateQuota(quota) {
  const missing = QUOTA_FIELDS.find((field) => !cleanText(quota[field]));
  return missing ? `${missing} 为必填项` : "";
}

function fuzzyQuota(quota, query) {
  return [quota.name, quota.showName, quota.description].some((value) =>
    cleanText(value).toLowerCase().includes(query)
  );
}

function dedupeImportedQuotas(rows) {
  const groups = new Map();
  for (const row of rows) {
    const name = cleanText(row.name);
    if (!name) continue;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(row);
  }
  return [...groups.values()].map((items) => items.find((item) => cleanText(item.region) === "bd") || items[0]);
}

function parseQuotaFile(filename, buffer) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".xlsx")) return parseXlsx(buffer);
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) return rowsToObjects(parseCsv(buffer.toString("utf8")));
  throw new Error("仅支持 .csv 和 .xlsx 文件");
}

function parseCsv(text) {
  const clean = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;
  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];
    const next = clean[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(value);
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }
  row.push(value);
  if (row.some((cell) => cell !== "")) rows.push(row);
  return rows;
}

function rowsToObjects(rows) {
  const headers = rows[0]?.map((item) => cleanText(item).replace(/^\uFEFF/, "")) || [];
  return rows.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] || ""])));
}

function parseXlsx(buffer) {
  const entries = unzip(buffer);
  const sharedStrings = parseSharedStrings(entries.get("xl/sharedStrings.xml")?.toString("utf8") || "");
  const sheetPath = findFirstSheetPath(entries);
  const sheet = entries.get(sheetPath);
  if (!sheet) throw new Error("未找到 Excel 工作表");
  const rows = parseSheetXml(sheet.toString("utf8"), sharedStrings);
  return rowsToObjects(rows);
}

function unzip(buffer) {
  const entries = new Map();
  let offset = buffer.lastIndexOf(Buffer.from("PK\x05\x06", "binary"));
  if (offset === -1) throw new Error("Excel 文件格式不正确");
  const centralDirectoryOffset = buffer.readUInt32LE(offset + 16);
  offset = centralDirectoryOffset;
  while (buffer.readUInt32LE(offset) === 0x02014b50) {
    const compression = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.slice(offset + 46, offset + 46 + fileNameLength).toString("utf8");
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.slice(dataStart, dataStart + compressedSize);
    const data = compression === 0 ? compressed : zlib.inflateRawSync(compressed);
    entries.set(name, data);
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

function findFirstSheetPath(entries) {
  if (entries.has("xl/worksheets/sheet1.xml")) return "xl/worksheets/sheet1.xml";
  return [...entries.keys()].find((key) => key.startsWith("xl/worksheets/sheet") && key.endsWith(".xml"));
}

function parseSharedStrings(xml) {
  return [...xml.matchAll(/<si[\s\S]*?<\/si>/g)].map((match) => {
    const textParts = [...match[0].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((part) => xmlDecode(part[1]));
    return textParts.join("");
  });
}

function parseSheetXml(xml, sharedStrings) {
  return [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((rowMatch) => {
    const cells = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const ref = attrs.match(/\sr="([A-Z]+)(\d+)"/)?.[1] || "";
      const index = ref ? columnIndex(ref) : cells.length;
      const type = attrs.match(/\st="([^"]+)"/)?.[1] || "";
      const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] || body.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] || "";
      cells[index] = type === "s" ? sharedStrings[Number(raw)] || "" : xmlDecode(raw);
    }
    return cells.map((cell) => cell || "");
  });
}

function columnIndex(ref) {
  return [...ref].reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

function xmlDecode(value) {
  return String(value)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

async function readJson(req) {
  const buffer = await readBuffer(req);
  return buffer.length ? JSON.parse(buffer.toString("utf8")) : {};
}

function readBuffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const ext = path.extname(filePath);
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8"
  };
  res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

function cleanText(value) {
  return String(value ?? "").trim();
}
