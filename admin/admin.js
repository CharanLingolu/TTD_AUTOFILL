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

const detailsModal = $("detailsModal");
const detailsBody = $("detailsBody");

const mailModal = $("mailModal");
const mailTo = $("mailTo");
const mailMsg = $("mailMsg");

let token = sessionStorage.getItem("ttd_admin_token") || "";
let allCoupons = [];
let loadTimer = null;
let toastTimer = null;
let pendingConfirm = null;

const headers = () => ({
  "Content-Type": "application/json",
  "X-Admin-Token": token,
});

async function request(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    ...options,
    headers: {
      ...headers(),
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }

  return data;
}

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>'"]/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      }[char])
  );
}

/* =========================================================
   DATE / TIME
========================================================= */

function formatExpiry(value) {
  if (!value) {
    return "No expiry";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Invalid date";
  }

  return (
    new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }).format(date) + " IST"
  );
}

function formatDate(value) {
  if (!value) {
    return "Never";
  }

  return formatExpiry(value);
}

/* =========================================================
   COUPON EMAIL BODY
========================================================= */

function couponMailBody(coupon) {
  const expiry = coupon.expiresAt
    ? formatExpiry(coupon.expiresAt)
    : "No expiry";

  /*
   * IMPORTANT:
   *
   * We deliberately create the newline using
   * String.fromCharCode(13, 10).
   *
   * This produces an actual CRLF:
   *
   * \r\n
   *
   * and prevents Gmail from displaying literal
   * "\\n" characters.
   */

  const newLine = String.fromCharCode(13, 10);

  const lines = [
    "Hello,",
    "",
    "Thank you for using or contacting TTD Autofill Pro.",
    "",
    "Here is your coupon code:",
    coupon.code,
    "",
    `Coupon status: ${statusOf(coupon).label}`,
    `Maximum uses: ${coupon.maxUses}`,
    `Used: ${coupon.usedCount} / ${coupon.maxUses}`,
    `Created: ${formatDate(coupon.createdAt)}`,
    `Last used: ${formatDate(coupon.lastUsedAt)}`,
    `Expiry: ${expiry}`,
    "",
    "Please keep this coupon code safe.",
    "",
    "Regards,",
    "TTD Autofill Pro",
    "ttdautofillpro@gmail.com",
  ];

  return lines.join(newLine);
}

/* =========================================================
   REMAINING TIME
========================================================= */

function remaining(expiresAt) {
  if (!expiresAt) {
    return "No expiry";
  }

  const diff = new Date(expiresAt).getTime() - Date.now();

  if (!Number.isFinite(diff) || diff <= 0) {
    return "Expired";
  }

  let seconds = Math.floor(diff / 1000);

  const days = Math.floor(seconds / 86400);

  seconds %= 86400;

  const hours = Math.floor(seconds / 3600);

  seconds %= 3600;

  const minutes = Math.floor(seconds / 60);

  seconds %= 60;

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

/* =========================================================
   COUPON STATUS
========================================================= */

function statusOf(coupon) {
  if (!coupon.active) {
    return {
      label: "Disabled",
      cls: "disabled",
    };
  }

  if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() <= Date.now()) {
    return {
      label: "Expired",
      cls: "expired",
    };
  }

  if (Number(coupon.usedCount) >= Number(coupon.maxUses)) {
    return {
      label: "Used",
      cls: "used",
    };
  }

  return {
    label: "Active",
    cls: "active",
  };
}

/* =========================================================
   TOAST
========================================================= */

function showToast(message, type = "success") {
  clearTimeout(toastTimer);

  toast.textContent = message;

  toast.className = `toast ${type} show`;

  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 2600);
}

/* =========================================================
   LIVE STATUS
========================================================= */

function setLive(online) {
  livePill.classList.toggle("offline", !online);

  livePill.querySelector("b").textContent = online ? "Live" : "Offline";

  livePill.querySelector("small").textContent = online
    ? "Auto-sync"
    : "Retrying";
}

/* =========================================================
   RENDER COUPONS
========================================================= */

function render() {
  const query = ($("search")?.value || "").trim().toLowerCase();

  const filter = $("statusFilter")?.value || "all";

  const filtered = allCoupons.filter((coupon) => {
    const status = statusOf(coupon).cls;

    return (
      (!query || String(coupon.code).toLowerCase().includes(query)) &&
      (filter === "all" || status === filter)
    );
  });

  $("totalStat").textContent = allCoupons.length;

  $("activeStat").textContent = allCoupons.filter(
    (coupon) => statusOf(coupon).cls === "active"
  ).length;

  $("disabledStat").textContent = allCoupons.filter(
    (coupon) => statusOf(coupon).cls === "disabled"
  ).length;

  $("expiredStat").textContent = allCoupons.filter(
    (coupon) => statusOf(coupon).cls === "expired"
  ).length;

  if (!filtered.length) {
    table.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⌕</div>
        <h3>No coupons found</h3>
        <p>Try another search or status filter.</p>
      </div>
    `;

    return;
  }

  table.innerHTML = filtered
    .map((coupon) => {
      const status = statusOf(coupon);

      const usage = `${coupon.usedCount} / ${coupon.maxUses}`;

      return `
        <article class="coupon-row">

          <div class="coupon-main">

            <div class="coupon-code">

              <span class="code-label">
                COUPON
              </span>

              <code>
                ${escapeHtml(coupon.code)}
              </code>

              <button
                class="icon-btn"
                title="Copy coupon"
                data-copy="${escapeHtml(coupon.code)}"
              >
                ⧉
              </button>

            </div>

            <div class="coupon-meta">

              <span>
                <b>Usage</b>
                ${usage}
              </span>

              <span>
                <b>Expiry</b>
                ${formatExpiry(coupon.expiresAt)}
              </span>

            </div>

          </div>

          <div class="time-block">

            <span>
              REMAINING
            </span>

            <strong
              class="remaining"
              data-expiry="${coupon.expiresAt || ""}"
            >
              ${remaining(coupon.expiresAt)}
            </strong>

          </div>

          <div class="status-block">

            <span
              class="badge ${status.cls}"
            >
              <i></i>
              ${status.label}
            </span>

          </div>

          <div class="row-actions">

            ${
              coupon.active
                ? `
                  <button
                    class="action-btn disable"
                    data-toggle="${escapeHtml(coupon.code)}"
                    data-active="false"
                  >
                    Disable
                  </button>
                `
                : `
                  <button
                    class="action-btn enable"
                    data-toggle="${escapeHtml(coupon.code)}"
                    data-active="true"
                  >
                    Enable
                  </button>
                `
            }

            <button
              class="action-btn details"
              data-details="${escapeHtml(coupon.code)}"
            >
              ⓘ Details
            </button>

            <button
              class="action-btn mail"
              data-mail="${escapeHtml(coupon.code)}"
            >
              ✉ Mail
            </button>

            <button
              class="action-btn delete"
              data-delete="${escapeHtml(coupon.code)}"
            >
              Delete
            </button>

          </div>

        </article>
      `;
    })
    .join("");

  /* COPY */

  table.querySelectorAll("[data-copy]").forEach((button) => {
    button.onclick = async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy);

        button.textContent = "✓";

        showToast("Coupon copied");

        setTimeout(() => {
          button.textContent = "⧉";
        }, 900);
      } catch {
        showToast("Could not copy coupon", "error");
      }
    };
  });

  /* ENABLE / DISABLE */

  table.querySelectorAll("[data-toggle]").forEach((button) => {
    button.onclick = async () => {
      const code = button.dataset.toggle;

      const active = button.dataset.active === "true";

      button.disabled = true;

      try {
        await request(`/api/admin/coupons/${encodeURIComponent(code)}`, {
          method: "PATCH",
          body: JSON.stringify({
            active,
          }),
        });

        await load();

        showToast(
          active ? `${code} enabled` : `${code} disabled — access revoked`
        );
      } catch (error) {
        button.disabled = false;

        showToast(error.message, "error");
      }
    };
  });

  /* DETAILS */

  table.querySelectorAll("[data-details]").forEach((button) => {
    button.onclick = () => {
      openDetails(button.dataset.details);
    };
  });

  /* MAIL */

  table.querySelectorAll("[data-mail]").forEach((button) => {
    button.onclick = () => {
      openMail(button.dataset.mail);
    };
  });

  /* DELETE */

  table.querySelectorAll("[data-delete]").forEach((button) => {
    button.onclick = () => {
      openConfirm(button.dataset.delete);
    };
  });
}

/* =========================================================
   LOAD COUPONS
========================================================= */

async function load(silent = false) {
  if (!silent) {
    table.innerHTML = `
      <div class="loading-state">
        <div class="spinner"></div>
        <span>Loading coupons…</span>
      </div>
    `;
  }

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
      table.innerHTML = `
        <div class="empty-state error-state">

          <div class="empty-icon">
            !
          </div>

          <h3>
            Could not load coupons
          </h3>

          <p>
            ${escapeHtml(error.message)}
          </p>

        </div>
      `;
    }
  }
}

/* =========================================================
   REALTIME
========================================================= */

function startRealtime() {
  clearInterval(loadTimer);

  loadTimer = setInterval(() => load(true), 1500);
}

/* =========================================================
   LOGIN / PANEL
========================================================= */

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

/* =========================================================
   FIND COUPON
========================================================= */

function findCoupon(code) {
  return allCoupons.find(
    (coupon) => String(coupon.code).toUpperCase() === String(code).toUpperCase()
  );
}

/* =========================================================
   DETAILS MODAL
========================================================= */

function openDetails(code) {
  const coupon = findCoupon(code);

  if (!coupon) {
    return;
  }

  const status = statusOf(coupon);

  detailsBody.innerHTML = `

    <div class="detail-line">
      <span>Coupon</span>
      <b>
        ${escapeHtml(coupon.code)}
      </b>
    </div>

    <div class="detail-line">
      <span>Status</span>
      <b>
        ${escapeHtml(status.label)}
      </b>
    </div>

    <div class="detail-line">
      <span>Created</span>
      <b>
        ${escapeHtml(formatDate(coupon.createdAt))}
      </b>
    </div>

    <div class="detail-line">
      <span>Last used</span>
      <b>
        ${escapeHtml(formatDate(coupon.lastUsedAt))}
      </b>
    </div>

    <div class="detail-line">
      <span>Usage</span>
      <b>
        ${escapeHtml(`${coupon.usedCount} / ${coupon.maxUses}`)}
      </b>
    </div>

    <div class="detail-line">
      <span>Expiry</span>
      <b>
        ${escapeHtml(formatDate(coupon.expiresAt))}
      </b>
    </div>

  `;

  detailsModal.classList.remove("hidden");

  detailsModal.setAttribute("aria-hidden", "false");
}

function closeDetails() {
  detailsModal.classList.add("hidden");

  detailsModal.setAttribute("aria-hidden", "true");
}

/* =========================================================
   MAIL MODAL
========================================================= */

function openMail(code) {
  const coupon = findCoupon(code);

  if (!coupon) {
    return;
  }

  mailTo.value = "";

  mailMsg.textContent = "";

  mailMsg.className = "form-msg";

  mailModal.dataset.couponCode = coupon.code;

  mailModal.classList.remove("hidden");

  mailModal.setAttribute("aria-hidden", "false");

  setTimeout(() => mailTo.focus(), 50);
}

function closeMail() {
  mailModal.classList.add("hidden");

  mailModal.setAttribute("aria-hidden", "true");
}

/* =========================================================
   DELETE CONFIRMATION
========================================================= */

function openConfirm(code) {
  pendingConfirm = code;

  $("modalTitle").textContent = "Delete coupon?";

  $("modalText").innerHTML = `
    You are about to permanently delete
    <strong>
      ${escapeHtml(code)}
    </strong>.

    Any license issued from this coupon
    will be revoked immediately.

    This action cannot be undone.
  `;

  $("confirmModalBtn").disabled = false;

  $("confirmModalBtn").textContent = "Delete permanently";

  $("confirmModal").classList.remove("hidden");

  $("confirmModal").setAttribute("aria-hidden", "false");
}

function closeConfirm() {
  pendingConfirm = null;

  $("confirmModal").classList.add("hidden");

  $("confirmModal").setAttribute("aria-hidden", "true");
}

/* =========================================================
   LOGIN
========================================================= */

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
  if (event.key === "Enter") {
    $("loginBtn").click();
  }
});

/* =========================================================
   LOGOUT
========================================================= */

$("logout").onclick = () => {
  sessionStorage.removeItem("ttd_admin_token");

  token = "";

  showLogin();
};

/* =========================================================
   REFRESH
========================================================= */

$("refresh").onclick = () => {
  load();
};

/* =========================================================
   GENERATE COUPONS
========================================================= */

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

        expiresAt: expiry ? new Date(expiry).toISOString() : "",
      }),
    });

    msg.textContent = `Created ${data.coupons.length} coupon${
      data.coupons.length === 1 ? "" : "s"
    }.`;

    newCodes.innerHTML = data.coupons
      .map(
        (coupon) => `
              <div class="new-code">

                <div>
                  <span>NEW</span>

                  <code>
                    ${escapeHtml(coupon.code)}
                  </code>
                </div>

                <button
                  class="icon-btn"
                  data-copy-new="${escapeHtml(coupon.code)}"
                >
                  ⧉ Copy
                </button>

              </div>
            `
      )
      .join("");

    newCodes.querySelectorAll("[data-copy-new]").forEach((button) => {
      button.onclick = async () => {
        try {
          await navigator.clipboard.writeText(button.dataset.copyNew);

          button.textContent = "✓ Copied";

          setTimeout(() => {
            button.textContent = "⧉ Copy";
          }, 1000);
        } catch {
          showToast("Could not copy coupon", "error");
        }
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

/* =========================================================
   QUICK EXPIRY
========================================================= */

document.querySelectorAll("[data-expiry]").forEach((button) => {
  button.onclick = () => {
    const days = button.dataset.expiry;

    if (days === "none") {
      $("expiry").value = "";

      return;
    }

    const date = new Date(Date.now() + Number(days) * 86400000);

    const pad = (number) => String(number).padStart(2, "0");

    const local = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
      date.getDate()
    )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;

    $("expiry").value = local;
  };
});

/* =========================================================
   SEARCH / FILTER
========================================================= */

$("search").addEventListener("input", render);

$("statusFilter").addEventListener("change", render);

$("refresh").addEventListener("click", () => {
  showToast("Dashboard refreshed");
});

/* =========================================================
   DELETE MODAL
========================================================= */

$("cancelModal").onclick = closeConfirm;

$("confirmModal").querySelector("[data-close-modal]").onclick = closeConfirm;

$("confirmModalBtn").onclick = async () => {
  if (!pendingConfirm) {
    return;
  }

  const code = pendingConfirm;

  const button = $("confirmModalBtn");

  button.disabled = true;

  button.textContent = "Deleting…";

  try {
    const data = await request(
      `/api/admin/coupons/${encodeURIComponent(code)}`,
      {
        method: "DELETE",
      }
    );

    closeConfirm();

    await load(true);

    showToast(
      `${code} deleted${
        data.deleted?.revokedLicenses
          ? ` • ${data.deleted.revokedLicenses} license(s) revoked`
          : ""
      }`
    );
  } catch (error) {
    button.disabled = false;

    button.textContent = "Delete permanently";

    showToast(error.message, "error");
  }
};

/* =========================================================
   DETAILS MODAL
========================================================= */

$("closeDetails").onclick = closeDetails;

detailsModal.querySelector("[data-close-details]").onclick = closeDetails;

/* =========================================================
   MAIL MODAL
========================================================= */

$("cancelMail").onclick = closeMail;

mailModal.querySelector("[data-close-mail]").onclick = closeMail;

/* =========================================================
   OPEN GMAIL
========================================================= */

$("sendMail").onclick = () => {
  const email = mailTo.value.trim();

  /*
   * Correct email validation.
   *
   * IMPORTANT:
   * Use \s, not \\s.
   */

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    mailMsg.textContent = "Enter a valid email address.";

    mailMsg.className = "form-msg error-text";

    return;
  }

  const coupon = findCoupon(mailModal.dataset.couponCode);

  if (!coupon) {
    mailMsg.textContent = "Coupon not found. Refresh and try again.";

    mailMsg.className = "form-msg error-text";

    return;
  }

  const subject = `TTD Autofill Pro Coupon - ${coupon.code}`;

  /*
   * Build the email body using REAL
   * CRLF line breaks.
   */

  const body = couponMailBody(coupon);

  /*
   * Gmail web composer.
   *
   * This works on laptop/desktop even
   * when Windows has no default mail
   * application configured.
   */

  const gmailComposeUrl =
    "https://mail.google.com/mail/?view=cm&fs=1" +
    "&to=" +
    encodeURIComponent(email) +
    "&su=" +
    encodeURIComponent(subject) +
    "&body=" +
    encodeURIComponent(body);

  /*
   * Open Gmail in a new tab.
   */

  const popup = window.open(gmailComposeUrl, "_blank", "noopener,noreferrer");

  /*
   * If popup is blocked, open it
   * in the current tab.
   */

  if (!popup) {
    window.location.href = gmailComposeUrl;
  }

  closeMail();
};

/* =========================================================
   ESCAPE KEY
========================================================= */

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeConfirm();

    closeDetails();

    closeMail();
  }
});

/* =========================================================
   UPDATE REMAINING TIME
========================================================= */

setInterval(() => {
  document.querySelectorAll(".remaining").forEach((element) => {
    element.textContent = remaining(element.dataset.expiry);
  });

  render();
}, 1000);

/* =========================================================
   START
========================================================= */

if (token) {
  showPanel();
} else {
  showLogin();
}
