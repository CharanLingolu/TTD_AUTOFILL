const $ = (id) => document.getElementById(id);

const login = $("login");
const panel = $("panel");
const tokenEl = $("token");
const loginMsg = $("loginMsg");
const msg = $("msg");
const table = $("table");
const newCodes = $("newCodes");
const toast = $("toast");
const livePill = $("livePill");

let token = sessionStorage.getItem("ttd_admin_token") || "";
let allCoupons = [];
let loadTimer = null;
let toastTimer = null;
let pendingConfirm = null;

const headers = () => ({
  "Content-Type": "application/json",
  "X-Admin-Token": token
});

async function request(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    ...options,
    headers: { ...headers(), ...(options.headers || {}) }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }

  return data;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  })[char]);
}

function formatExpiry(value) {
  if (!value) return "No expiry";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Invalid date";

  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  }).format(date) + " IST";
}

function remaining(expiresAt) {
  if (!expiresAt) return "No expiry";

  const diff = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(diff) || diff <= 0) return "Expired";

  let seconds = Math.floor(diff / 1000);
  const days = Math.floor(seconds / 86400);
  seconds %= 86400;
  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;
  const minutes = Math.floor(seconds / 60);
  seconds %= 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function statusOf(coupon) {
  if (!coupon.active) return { label: "Disabled", cls: "disabled" };
  if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() <= Date.now()) {
    return { label: "Expired", cls: "expired" };
  }
  if (Number(coupon.usedCount) >= Number(coupon.maxUses)) {
    return { label: "Used", cls: "used" };
  }
  return { label: "Active", cls: "active" };
}

function showToast(message, type = "success") {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `toast ${type} show`;
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function setLive(online) {
  livePill.classList.toggle("offline", !online);
  livePill.querySelector("b").textContent = online ? "Live" : "Offline";
  livePill.querySelector("small").textContent = online ? "Auto-sync" : "Retrying";
}

function render() {
  const query = ($("search")?.value || "").trim().toLowerCase();
  const filter = $("statusFilter")?.value || "all";

  const filtered = allCoupons.filter((coupon) => {
    const status = statusOf(coupon).cls;
    return (
      (!query || coupon.code.toLowerCase().includes(query)) &&
      (filter === "all" || status === filter)
    );
  });

  $("totalStat").textContent = allCoupons.length;
  $("activeStat").textContent = allCoupons.filter(c => statusOf(c).cls === "active").length;
  $("disabledStat").textContent = allCoupons.filter(c => statusOf(c).cls === "disabled").length;
  $("expiredStat").textContent = allCoupons.filter(c => statusOf(c).cls === "expired").length;

  if (!filtered.length) {
    table.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⌕</div>
        <h3>No coupons found</h3>
        <p>Try another search or status filter.</p>
      </div>`;
    return;
  }

  table.innerHTML = filtered.map((coupon) => {
    const status = statusOf(coupon);
    const usage = `${coupon.usedCount} / ${coupon.maxUses}`;

    return `
      <article class="coupon-row">
        <div class="coupon-main">
          <div class="coupon-code">
            <span class="code-label">COUPON</span>
            <code>${escapeHtml(coupon.code)}</code>
            <button class="icon-btn" title="Copy coupon" data-copy="${escapeHtml(coupon.code)}">⧉</button>
          </div>
          <div class="coupon-meta">
            <span><b>Usage</b> ${usage}</span>
            <span><b>Expiry</b> ${formatExpiry(coupon.expiresAt)}</span>
          </div>
        </div>

        <div class="time-block">
          <span>REMAINING</span>
          <strong class="remaining" data-expiry="${coupon.expiresAt || ""}">
            ${remaining(coupon.expiresAt)}
          </strong>
        </div>

        <div class="status-block">
          <span class="badge ${status.cls}"><i></i>${status.label}</span>
        </div>

        <div class="row-actions">
          ${coupon.active
            ? `<button class="action-btn disable" data-toggle="${escapeHtml(coupon.code)}" data-active="false">Disable</button>`
            : `<button class="action-btn enable" data-toggle="${escapeHtml(coupon.code)}" data-active="true">Enable</button>`}
          <button class="action-btn delete" data-delete="${escapeHtml(coupon.code)}">Delete</button>
        </div>
      </article>`;
  }).join("");

  table.querySelectorAll("[data-copy]").forEach((button) => {
    button.onclick = async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy);
        button.textContent = "✓";
        showToast("Coupon copied");
        setTimeout(() => button.textContent = "⧉", 900);
      } catch {
        showToast("Could not copy coupon", "error");
      }
    };
  });

  table.querySelectorAll("[data-toggle]").forEach((button) => {
    button.onclick = async () => {
      const code = button.dataset.toggle;
      const active = button.dataset.active === "true";
      button.disabled = true;

      try {
        await request(`/api/admin/coupons/${encodeURIComponent(code)}`, {
          method: "PATCH",
          body: JSON.stringify({ active })
        });

        await load();
        showToast(active ? `${code} enabled` : `${code} disabled — access revoked`);
      } catch (error) {
        button.disabled = false;
        showToast(error.message, "error");
      }
    };
  });

  table.querySelectorAll("[data-delete]").forEach((button) => {
    button.onclick = () => openConfirm(button.dataset.delete);
  });
}

async function load(silent = false) {
  if (!silent) table.innerHTML = `<div class="loading-state"><div class="spinner"></div><span>Loading coupons…</span></div>`;

  try {
    const data = await request("/api/admin/coupons");
    allCoupons = Array.isArray(data.coupons) ? data.coupons : [];
    setLive(true);
    render();
  } catch (error) {
    setLive(false);

    if (error.message === "Unauthorized") {
      sessionStorage.removeItem("ttd_admin_token");
      token = "";
      showLogin();
      return;
    }

    if (!silent) {
      table.innerHTML = `<div class="empty-state error-state"><div class="empty-icon">!</div><h3>Could not load coupons</h3><p>${escapeHtml(error.message)}</p></div>`;
    }
  }
}

function startRealtime() {
  clearInterval(loadTimer);

  // Keep admin status synchronized with DB. The mutation endpoints themselves
  // already revoke licenses before returning success.
  loadTimer = setInterval(() => load(true), 1500);
}

function showLogin() {
  login.classList.remove("hidden");
  panel.classList.add("hidden");
  clearInterval(loadTimer);
  setLive(true);
  setTimeout(() => tokenEl.focus(), 50);
}

function showPanel() {
  login.classList.add("hidden");
  panel.classList.remove("hidden");
  load();
  startRealtime();
}

function openConfirm(code) {
  pendingConfirm = code;
  $("modalTitle").textContent = "Delete coupon?";
  $("modalText").innerHTML = `
    You are about to permanently delete <strong>${escapeHtml(code)}</strong>.
    Any license issued from this coupon will be revoked immediately. This action cannot be undone.`;
  $("confirmModalBtn").disabled = false;
  $("confirmModal").classList.remove("hidden");
  $("confirmModal").setAttribute("aria-hidden", "false");
}

function closeConfirm() {
  pendingConfirm = null;
  $("confirmModal").classList.add("hidden");
  $("confirmModal").setAttribute("aria-hidden", "true");
}

$("loginBtn").onclick = async () => {
  token = tokenEl.value.trim();
  if (!token) {
    loginMsg.textContent = "Enter your admin token.";
    return;
  }

  loginMsg.textContent = "Checking…";
  $("loginBtn").disabled = true;

  try {
    await request("/api/admin/coupons");
    sessionStorage.setItem("ttd_admin_token", token);
    loginMsg.textContent = "";
    showPanel();
  } catch (error) {
    token = "";
    loginMsg.textContent = error.message;
  } finally {
    $("loginBtn").disabled = false;
  }
};

tokenEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") $("loginBtn").click();
});

$("logout").onclick = () => {
  sessionStorage.removeItem("ttd_admin_token");
  token = "";
  showLogin();
};

$("refresh").onclick = () => load();

$("generate").onclick = async () => {
  msg.textContent = "Generating…";
  newCodes.innerHTML = "";
  $("generate").disabled = true;

  try {
    const expiry = $("expiry").value;
    const data = await request("/api/admin/coupons", {
      method: "POST",
      body: JSON.stringify({
        count: Number($("count").value),
        maxUses: Number($("uses").value),
        expiresAt: expiry ? new Date(expiry).toISOString() : ""
      })
    });

    msg.textContent = `Created ${data.coupons.length} coupon${data.coupons.length === 1 ? "" : "s"}.`;

    newCodes.innerHTML = data.coupons.map((coupon) => `
      <div class="new-code">
        <div><span>NEW</span><code>${escapeHtml(coupon.code)}</code></div>
        <button class="icon-btn" data-copy-new="${escapeHtml(coupon.code)}">⧉ Copy</button>
      </div>
    `).join("");

    newCodes.querySelectorAll("[data-copy-new]").forEach((button) => {
      button.onclick = async () => {
        await navigator.clipboard.writeText(button.dataset.copyNew);
        button.textContent = "✓ Copied";
        setTimeout(() => button.textContent = "⧉ Copy", 1000);
      };
    });

    await load(true);
    showToast("Coupons generated successfully");
  } catch (error) {
    msg.textContent = error.message;
    showToast(error.message, "error");
  } finally {
    $("generate").disabled = false;
  }
};

document.querySelectorAll("[data-expiry]").forEach((button) => {
  button.onclick = () => {
    const days = button.dataset.expiry;
    if (days === "none") {
      $("expiry").value = "";
      return;
    }

    const date = new Date(Date.now() + Number(days) * 86400000);
    const pad = (n) => String(n).padStart(2, "0");
    const local = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    $("expiry").value = local;
  };
});

$("search").addEventListener("input", render);
$("statusFilter").addEventListener("change", render);
$("refresh").addEventListener("click", () => showToast("Dashboard refreshed"));

$("cancelModal").onclick = closeConfirm;
$("confirmModal").querySelector("[data-close-modal]").onclick = closeConfirm;

$("confirmModalBtn").onclick = async () => {
  if (!pendingConfirm) return;

  const code = pendingConfirm;
  const button = $("confirmModalBtn");
  button.disabled = true;
  button.textContent = "Deleting…";

  try {
    const data = await request(`/api/admin/coupons/${encodeURIComponent(code)}`, {
      method: "DELETE"
    });

    closeConfirm();
    await load(true);
    showToast(`${code} deleted${data.deleted?.revokedLicenses ? ` • ${data.deleted.revokedLicenses} license(s) revoked` : ""}`);
  } catch (error) {
    button.disabled = false;
    button.textContent = "Delete permanently";
    showToast(error.message, "error");
  }
};

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeConfirm();
});

setInterval(() => {
  document.querySelectorAll(".remaining").forEach((element) => {
    element.textContent = remaining(element.dataset.expiry);
  });
  render();
}, 1000);

if (token) showPanel();
else showLogin();
