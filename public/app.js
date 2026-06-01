const app = document.querySelector("#app");

const state = {
  user: null,
  needsSetup: false,
  tab: "quotas",
  quotas: [],
  users: [],
  query: "",
  manageQuery: "",
  message: "",
  error: "",
  modal: null
};

const quotaLabels = {
  productType: "产品类型",
  serviceType: "服务类型",
  name: "配额名称",
  showName: "控制台展示名称",
  description: "控制台展示描述",
  englishDescription: "英文描述",
  apply: "配额是否生效",
  automaticApprovalInterval: "自动审批范围",
  manualApprovalInterval: "人工审批范围"
};

const roleLabels = {
  super_admin: "超级管理员",
  admin: "管理员",
  user: "用户"
};

init();

async function init() {
  try {
    const setup = await api("/api/setup-status");
    state.needsSetup = setup.needsSetup === true;
    if (!state.needsSetup) {
      try {
        const me = await api("/api/me");
        state.user = me.user;
        await loadQuotas();
      } catch {
        state.user = null;
      }
    }
  } catch (error) {
    state.user = null;
    state.needsSetup = false;
    state.error = error.message;
  }
  render();
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "include",
    headers: options.body instanceof ArrayBuffer ? options.headers : {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });
  const contentType = response.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const data = isJson ? await response.json().catch(() => ({})) : {};
  if (!isJson) throw new Error("API 路由未正确部署，请检查 Vercel Functions 配置");
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

function render() {
  if (state.needsSetup) {
    renderAuth("setup");
    return;
  }
  if (!state.user) {
    renderAuth("login");
    return;
  }
  renderShell();
}

function renderAuth(mode) {
  app.innerHTML = `
    <section class="auth-page">
      <form class="auth-box" data-form="${mode}">
        <h1>${mode === "setup" ? "创建超级管理员" : "配额查询系统"}</h1>
        <p>${mode === "setup" ? "首次访问需要先创建唯一的初始超级管理员账号。" : "登录后查询和维护配额信息。"}</p>
        <div class="field">
          <label>用户名</label>
          <input name="username" autocomplete="username" required />
        </div>
        <div class="field">
          <label>密码</label>
          <input name="password" type="password" autocomplete="${mode === "setup" ? "new-password" : "current-password"}" required />
        </div>
        <button type="submit">${mode === "setup" ? "创建并进入" : "登录"}</button>
        ${state.error ? `<div class="error">${escapeHtml(state.error)}</div>` : ""}
      </form>
    </section>
  `;
  app.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await submitAuth(mode, Object.fromEntries(form.entries()));
  });
}

async function submitAuth(mode, payload) {
  clearFlash();
  try {
    const data = await api(mode === "setup" ? "/api/setup" : "/api/login", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    state.user = data.user;
    state.needsSetup = false;
    await loadQuotas();
  } catch (error) {
    state.error = error.message;
  }
  render();
}

function renderShell() {
  const canEdit = ["super_admin", "admin"].includes(state.user.role);
  const canManageUsers = state.user.role === "super_admin";
  app.innerHTML = `
    <section class="shell">
      <header class="topbar">
        <div class="brand">
          <h1>配额查询系统</h1>
          <span>${roleLabels[state.user.role]}</span>
        </div>
        <div class="actions">
          <span class="userline">${escapeHtml(state.user.username)}</span>
          <button class="secondary" data-action="logout">退出</button>
        </div>
      </header>
      <div class="content">
        <nav class="tabs">
          <button class="tab ${state.tab === "quotas" ? "active" : ""}" data-tab="quotas">配额查询</button>
          ${canEdit ? `<button class="tab ${state.tab === "manage" ? "active" : ""}" data-tab="manage">数据维护</button>` : ""}
          ${canManageUsers ? `<button class="tab ${state.tab === "users" ? "active" : ""}" data-tab="users">用户管理</button>` : ""}
        </nav>
        ${state.message ? `<div class="success">${escapeHtml(state.message)}</div>` : ""}
        ${state.error ? `<div class="error">${escapeHtml(state.error)}</div>` : ""}
        ${state.tab === "quotas" ? quotaSearchView(canEdit) : ""}
        ${state.tab === "manage" && canEdit ? manageView() : ""}
        ${state.tab === "users" && canManageUsers ? usersView() : ""}
      </div>
      ${modalView()}
    </section>
  `;
  bindShellEvents();
}

function quotaSearchView(canEdit) {
  const hasQuery = state.query.trim().length > 0;
  return `
    <section class="panel">
      <div class="toolbar">
        <form class="searchbar" data-form="search">
          <input name="q" value="${escapeAttr(state.query)}" placeholder="输入配额名称、控制台展示名称或控制台展示描述" />
          <button type="submit">查询</button>
          <button class="secondary" type="button" data-action="clear-search">清空</button>
        </form>
      </div>
      ${hasQuery ? quotaTable(state.quotas, canEdit) : `<div class="empty">请输入配额名称、控制台展示名称或控制台展示描述后查询</div>`}
    </section>
  `;
}

function manageView() {
  const query = state.manageQuery.trim().toLowerCase();
  const quotas = query
    ? state.quotas.filter((quota) => [quota.name, quota.showName, quota.description].some((value) => String(value || "").toLowerCase().includes(query)))
    : state.quotas;
  return `
    <section class="panel">
      <div class="panel-head">
        <h2>导入数据</h2>
      </div>
      <form class="import-row" data-form="import">
        <div class="field">
          <label>Excel/CSV 文件</label>
          <input type="file" name="file" accept=".xlsx,.csv" required />
        </div>
        <div class="field">
          <label>导入方式</label>
          <select name="mode">
            <option value="merge">合并更新</option>
            <option value="replace">替换全部</option>
          </select>
        </div>
        <button type="submit">导入</button>
      </form>
      <p class="notice">导入时会忽略 region、channel、endpoint；同一配额名称有多条记录时优先保留 region 为 bd 的记录。</p>
    </section>
    <section class="panel">
      <div class="panel-head">
        <h2>手动维护</h2>
        <button data-action="new-quota">新增配额</button>
      </div>
      <form class="searchbar" data-form="manage-search">
        <input name="q" value="${escapeAttr(state.manageQuery)}" placeholder="输入配额名称、控制台展示名称或控制台展示描述，快速定位要修改的数据" />
        <button type="submit">查询</button>
        <button class="secondary" type="button" data-action="clear-manage-search">清空</button>
      </form>
      <p class="notice">当前显示 ${quotas.length} / ${state.quotas.length} 条配额</p>
      ${quotaTable(quotas, true)}
    </section>
  `;
}

function usersView() {
  return `
    <section class="panel">
      <div class="panel-head">
        <h2>用户管理</h2>
        <button data-action="new-user">新增用户</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>用户名</th>
              <th>角色</th>
              <th>创建时间</th>
              <th>更新时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${state.users.map((user) => `
              <tr>
                <td>${escapeHtml(user.username)}</td>
                <td><span class="badge ${user.role}">${roleLabels[user.role]}</span></td>
                <td>${formatTime(user.createdAt)}</td>
                <td>${formatTime(user.updatedAt)}</td>
                <td><button class="secondary" data-action="edit-user" data-id="${user.id}">编辑</button></td>
              </tr>
            `).join("") || `<tr><td colspan="5" class="empty">暂无用户</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function quotaTable(quotas, canEdit) {
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>产品类型</th>
            <th>服务类型</th>
            <th>配额名称</th>
            <th>控制台展示名称</th>
            <th>控制台展示描述</th>
            <th>英文描述</th>
            <th>是否生效</th>
            <th>自动审批范围</th>
            <th>人工审批范围</th>
            ${canEdit ? "<th>操作</th>" : ""}
          </tr>
        </thead>
        <tbody>
          ${quotas.map((quota) => `
            <tr>
              <td>${escapeHtml(quota.productType)}</td>
              <td>${escapeHtml(quota.serviceType)}</td>
              <td>${escapeHtml(quota.name)}</td>
              <td>${escapeHtml(quota.showName)}</td>
              <td>${escapeHtml(quota.description)}</td>
              <td>${escapeHtml(quota.englishDescription)}</td>
              <td>${escapeHtml(quota.apply)}</td>
              <td>${escapeHtml(quota.automaticApprovalInterval)}</td>
              <td>${escapeHtml(quota.manualApprovalInterval)}</td>
              ${canEdit ? `
                <td>
                  <div class="actions">
                    <button class="secondary icon" title="编辑" data-action="edit-quota" data-id="${quota.id}">✎</button>
                    <button class="danger icon" title="删除" data-action="delete-quota" data-id="${quota.id}">×</button>
                  </div>
                </td>
              ` : ""}
            </tr>
          `).join("") || `<tr><td colspan="${canEdit ? 10 : 9}" class="empty">暂无匹配配额</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function modalView() {
  if (!state.modal) return "";
  if (state.modal.type === "quota") {
    const quota = state.modal.data || {};
    return `
      <div class="modal-backdrop">
        <form class="modal" data-form="quota">
          <h2>${quota.id ? "编辑配额" : "新增配额"}</h2>
          <input type="hidden" name="id" value="${escapeAttr(quota.id || "")}" />
          <div class="form-grid">
            ${Object.entries(quotaLabels).map(([key, label]) => `
              <div class="field ${["description", "englishDescription"].includes(key) ? "full" : ""}">
                <label>${label}</label>
                ${["description", "englishDescription"].includes(key)
                  ? `<textarea name="${key}" required>${escapeHtml(quota[key] || "")}</textarea>`
                  : `<input name="${key}" value="${escapeAttr(quota[key] || "")}" required />`}
              </div>
            `).join("")}
          </div>
          <div class="modal-actions">
            <button type="button" class="secondary" data-action="close-modal">取消</button>
            <button type="submit">保存</button>
          </div>
        </form>
      </div>
    `;
  }
  const user = state.modal.data || {};
  return `
    <div class="modal-backdrop">
      <form class="modal small" data-form="user">
        <h2>${user.id ? "编辑用户" : "新增用户"}</h2>
        <input type="hidden" name="id" value="${escapeAttr(user.id || "")}" />
        <div class="field">
          <label>用户名</label>
          <input name="username" value="${escapeAttr(user.username || "")}" required />
        </div>
        <div class="field">
          <label>角色</label>
          <select name="role" ${user.role === "super_admin" ? "" : ""}>
            ${Object.entries(roleLabels).map(([role, label]) => `
              <option value="${role}" ${user.role === role ? "selected" : ""} ${role === "super_admin" && user.role !== "super_admin" ? "disabled" : ""}>${label}</option>
            `).join("")}
          </select>
        </div>
        <div class="field">
          <label>${user.id ? "新密码（留空不修改）" : "密码"}</label>
          <input name="password" type="password" ${user.id ? "" : "required"} />
        </div>
        <div class="modal-actions">
          <button type="button" class="secondary" data-action="close-modal">取消</button>
          <button type="submit">保存</button>
        </div>
      </form>
    </div>
  `;
}

function bindShellEvents() {
  app.querySelector("[data-action='logout']")?.addEventListener("click", logout);
  app.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.tab = button.dataset.tab;
      clearFlash();
      if (state.tab === "users") await loadUsers();
      render();
    });
  });
  app.querySelector("[data-form='search']")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.query = new FormData(event.currentTarget).get("q") || "";
    await loadQuotas();
    render();
  });
  app.querySelector("[data-action='clear-search']")?.addEventListener("click", async () => {
    state.query = "";
    await loadQuotas();
    render();
  });
  app.querySelector("[data-form='import']")?.addEventListener("submit", importFile);
  app.querySelector("[data-form='manage-search']")?.addEventListener("submit", (event) => {
    event.preventDefault();
    state.manageQuery = new FormData(event.currentTarget).get("q") || "";
    render();
  });
  app.querySelector("[data-action='clear-manage-search']")?.addEventListener("click", () => {
    state.manageQuery = "";
    render();
  });
  app.querySelector("[data-action='new-quota']")?.addEventListener("click", () => openQuotaModal());
  app.querySelector("[data-action='new-user']")?.addEventListener("click", () => openUserModal());
  app.querySelectorAll("[data-action='edit-quota']").forEach((button) => {
    button.addEventListener("click", () => openQuotaModal(state.quotas.find((quota) => quota.id === button.dataset.id)));
  });
  app.querySelectorAll("[data-action='delete-quota']").forEach((button) => {
    button.addEventListener("click", () => deleteQuota(button.dataset.id));
  });
  app.querySelectorAll("[data-action='edit-user']").forEach((button) => {
    button.addEventListener("click", () => openUserModal(state.users.find((user) => user.id === button.dataset.id)));
  });
  app.querySelector("[data-action='close-modal']")?.addEventListener("click", closeModal);
  app.querySelector("[data-form='quota']")?.addEventListener("submit", saveQuota);
  app.querySelector("[data-form='user']")?.addEventListener("submit", saveUser);
}

async function loadQuotas() {
  const data = await api(`/api/quotas?q=${encodeURIComponent(state.query)}`);
  state.quotas = data.quotas;
}

async function loadUsers() {
  const data = await api("/api/users");
  state.users = data.users;
}

async function logout() {
  await api("/api/logout", { method: "POST", body: JSON.stringify({}) });
  state.user = null;
  state.quotas = [];
  render();
}

async function importFile(event) {
  event.preventDefault();
  clearFlash();
  const form = new FormData(event.currentTarget);
  const file = form.get("file");
  try {
    const result = await api("/api/import", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-File-Name": encodeURIComponent(file.name),
        "X-Import-Mode": form.get("mode")
      },
      body: await file.arrayBuffer()
    });
    state.message = `导入 ${result.imported} 条，当前共 ${result.total} 条配额`;
    await loadQuotas();
  } catch (error) {
    state.error = error.message;
  }
  render();
}

function openQuotaModal(quota = null) {
  clearFlash();
  state.modal = { type: "quota", data: quota ? { ...quota } : {} };
  render();
}

function openUserModal(user = null) {
  clearFlash();
  state.modal = { type: "user", data: user ? { ...user } : { role: "user" } };
  render();
}

function closeModal() {
  state.modal = null;
  render();
}

async function saveQuota(event) {
  event.preventDefault();
  clearFlash();
  const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
  const id = payload.id;
  delete payload.id;
  try {
    await api(id ? `/api/quotas/${id}` : "/api/quotas", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(payload)
    });
    state.message = "配额已保存";
    state.modal = null;
    await loadQuotas();
  } catch (error) {
    state.error = error.message;
  }
  render();
}

async function deleteQuota(id) {
  if (!confirm("确定删除这条配额吗？")) return;
  clearFlash();
  try {
    await api(`/api/quotas/${id}`, { method: "DELETE" });
    state.message = "配额已删除";
    await loadQuotas();
  } catch (error) {
    state.error = error.message;
  }
  render();
}

async function saveUser(event) {
  event.preventDefault();
  clearFlash();
  const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
  const id = payload.id;
  delete payload.id;
  if (!payload.password) delete payload.password;
  try {
    await api(id ? `/api/users/${id}` : "/api/users", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(payload)
    });
    state.message = "用户已保存";
    state.modal = null;
    await loadUsers();
  } catch (error) {
    state.error = error.message;
  }
  render();
}

function clearFlash() {
  state.message = "";
  state.error = "";
}

function formatTime(value) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
