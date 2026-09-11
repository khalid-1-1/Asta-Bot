// dashboard/public/app.js
// -----------------------------------------------------------------------
// Stage 10 (Dashboard Redesign & Visualization) - shared shell for every
// Dashboard page: sidebar, topbar (live status/uptime/connection/user/
// notifications), and small reusable state/format helpers.
//
// Still plain browser JS, no build step, no framework - same convention
// this file has followed since Stage 7. All existing page scripts keep
// calling requireAuth() / renderShell() / api() / escapeHtml() exactly as
// before; everything here is additive on top of those four functions.
// -----------------------------------------------------------------------

let CSRF_TOKEN = null;
let CURRENT_USER = null;
let CURRENT_ROLE = null;
let CURRENT_ROLE_LABEL = null;
let CURRENT_PERMISSIONS = [];
let CURRENT_IS_PRIMARY_OWNER = false;

function can(permission) {
    return CURRENT_PERMISSIONS.includes(permission);
}

async function api(path, options = {}) {
    const opts = {
        method: options.method || "GET",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
    };
    if (options.method && options.method !== "GET" && CSRF_TOKEN) {
        opts.headers["X-CSRF-Token"] = CSRF_TOKEN;
    }
    if (options.body) opts.body = JSON.stringify(options.body);

    let res;
    try {
        res = await fetch(path, opts);
    } catch (networkErr) {
        // Distinguish "server unreachable" from an ordinary API error so
        // pages can show a proper Offline state instead of a generic one.
        const err = new Error("Cannot reach the Dashboard server.");
        err.offline = true;
        throw err;
    }
    if (res.status === 401) {
        window.location.href = "/login";
        throw new Error("Unauthorized");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
}

async function requireAuth() {
    try {
        const me = await api("/api/auth/me");
        CSRF_TOKEN = me.csrfToken;
        CURRENT_USER = me.username;
        CURRENT_ROLE = me.role;
        CURRENT_ROLE_LABEL = me.roleLabel;
        CURRENT_PERMISSIONS = me.permissions || [];
        CURRENT_IS_PRIMARY_OWNER = Boolean(me.isPrimaryOwner);
        // A "pending" account (self-registered from the login page) has no
        // permissions at all until an Owner/Admin assigns it a role - send
        // it straight to the Account page, which is the only place with
        // anything meaningful to show, instead of a broken/empty Overview.
        if (CURRENT_ROLE === "pending" && window.location.pathname !== "/account") {
            window.location.href = "/account";
            throw new Error("Pending approval");
        }
        return me;
    } catch (e) {
        if (e.message === "Pending approval") throw e;
        window.location.href = "/login";
        throw e;
    }
}

async function logout() {
    try {
        await api("/api/auth/logout", { method: "POST" });
    } catch (e) {
        /* ignore */
    }
    window.location.href = "/login";
}

function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
}

/* ------------------------------------------------------------------- *
 * Formatting helpers (used across pages)
 * ------------------------------------------------------------------- */
function fmtUptime(seconds) {
    if (seconds == null || Number.isNaN(seconds)) return "-";
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    return `${m}m ${s}s`;
}
function fmtBytes(bytes) {
    if (!bytes) return "0 MB";
    return (bytes / 1024 / 1024).toFixed(1) + " MB";
}
function fmtWhen(iso) {
    if (!iso) return "-";
    try { return new Date(iso).toLocaleString(); } catch (e) { return String(iso); }
}
function fmtRelative(iso) {
    if (!iso) return "-";
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return String(iso);
    const diff = Date.now() - t;
    if (diff < 5000) return "just now";
    if (diff < 60000) return Math.floor(diff / 1000) + "s ago";
    if (diff < 3600000) return Math.floor(diff / 60000) + "m ago";
    if (diff < 86400000) return Math.floor(diff / 3600000) + "h ago";
    return Math.floor(diff / 86400000) + "d ago";
}
function fmtNum(n) {
    if (n == null || Number.isNaN(n)) return "0";
    return Number(n).toLocaleString();
}
function initials(name) {
    return String(name || "?").trim().slice(0, 2).toUpperCase();
}

/**
 * Runs `apply` (which typically replaces #content's innerHTML) without
 * letting the page jump to the top. Auto-refreshing pages (Overview,
 * Alerts, Statistics) replace their whole content block on every poll;
 * if the new content is even slightly shorter than the old one for a
 * moment, the browser clamps the scroll position back up - which reads
 * as an annoying "jump" while someone is reading further down the page.
 * Capturing the scroll position first and restoring it right after the
 * browser reflows (next animation frame) keeps the view exactly where
 * the user left it.
 */
function withPreservedScroll(apply) {
    const y = window.scrollY;
    apply();
    requestAnimationFrame(() => window.scrollTo(0, y));
}

/* ------------------------------------------------------------------- *
 * Reusable state blocks (loading / empty / error / offline)
 * ------------------------------------------------------------------- */
function loadingState(message) {
    return `<div class="state-box">
        <div class="spinner"></div>
        <div class="state-msg">${escapeHtml(message || t("loading"))}</div>
    </div>`;
}
function skeletonGrid(count = 8) {
    return `<div class="grid">${Array.from({ length: count }).map(() => `<div class="skeleton skeleton-card"></div>`).join("")}</div>`;
}
function emptyState(title, message, icon) {
    return `<div class="state-box">
        <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">${icon || '<path d="M3 3v18h18M7 15l3.5-4.5 3 3L19 8" stroke-linecap="round" stroke-linejoin="round"/>'}</svg>
        <div class="state-title">${escapeHtml(title || t("nothingHereYet"))}</div>
        ${message ? `<div class="state-msg">${escapeHtml(message)}</div>` : ""}
    </div>`;
}
function errorState(message) {
    return `<div class="state-box error">
        <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01" stroke-linecap="round"/></svg>
        <div class="state-title">${escapeHtml(t("somethingWentWrong"))}</div>
        <div class="state-msg">${escapeHtml(message || t("pleaseTryAgain"))}</div>
    </div>`;
}
function offlineState(message) {
    return `<div class="state-box offline">
        <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9z"/><path d="M5 13l2 2a8.5 8.5 0 0110 0l2-2a11.5 11.5 0 00-14 0z"/><path d="M9 17l2 2a3.5 3.5 0 012 0l2-2a6.5 6.5 0 00-6 0z"/><path d="M2 2l20 20" stroke-linecap="round"/></svg>
        <div class="state-title">${escapeHtml(t("botOffline"))}</div>
        <div class="state-msg">${escapeHtml(message || t("sectionNeedsBotConnected"))}</div>
    </div>`;
}

/* ------------------------------------------------------------------- *
 * Icons (inline SVG, no icon-font/CDN dependency)
 * ------------------------------------------------------------------- */
const ICONS = {
    overview: '<path d="M3 13h4v8H3zM10 3h4v18h-4zM17 8h4v13h-4z" stroke-linejoin="round"/>',
    stats: '<path d="M3 3v18h18M7 14l3-4 3 3 5-7" stroke-linecap="round" stroke-linejoin="round"/>',
    plugins: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M7.5 7.5l2 2M14.5 14.5l2 2M16.5 7.5l-2 2M9.5 14.5l-2 2" stroke-linecap="round"/><circle cx="12" cy="12" r="3"/>',
    logs: '<path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h8M8 17h4" stroke-linecap="round"/>',
    controls: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.9 2.9l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.6V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1-1.6 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.9-2.9l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.6-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.6-1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.9-2.9l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.6V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.6 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.9 2.9l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.6 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.6 1z" stroke-linecap="round" stroke-linejoin="round"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.9 2.9l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.6V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1-1.6 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.9-2.9l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.6-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.6-1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.9-2.9l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.6V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.6 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.9 2.9l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.6 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.6 1z" stroke-linecap="round" stroke-linejoin="round"/>',
    alerts: '<path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" stroke-linecap="round" stroke-linejoin="round"/><path d="M13.7 21a2 2 0 01-3.4 0" stroke-linecap="round"/>',
    scheduler: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2" stroke-linecap="round" stroke-linejoin="round"/>',
    backups: '<path d="M4 7v10a2 2 0 002 2h12a2 2 0 002-2V7" stroke-linecap="round"/><path d="M2 7l10-4 10 4-10 4z" stroke-linejoin="round"/><path d="M8 14l4-3 4 3" stroke-linecap="round" stroke-linejoin="round"/>',
    audit: '<path d="M9 12l2 2 4-4" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" stroke-linejoin="round"/>',
    bell: '<path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" stroke-linecap="round" stroke-linejoin="round"/><path d="M13.7 21a2 2 0 01-3.4 0" stroke-linecap="round"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16" stroke-linecap="round"/>',
    logout: '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" stroke-linecap="round" stroke-linejoin="round"/><path d="M16 17l5-5-5-5M21 12H9" stroke-linecap="round" stroke-linejoin="round"/>',
    uptime: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2" stroke-linecap="round" stroke-linejoin="round"/>',
    link: '<path d="M10 13a5 5 0 007.07 0l2.83-2.83a5 5 0 00-7.07-7.07L11.5 4.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 11a5 5 0 00-7.07 0L4.1 13.83a5 5 0 007.07 7.07L12.5 19.5" stroke-linecap="round" stroke-linejoin="round"/>',
    users: '<path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" stroke-linecap="round" stroke-linejoin="round"/>',
    account: '<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6" stroke-linecap="round" stroke-linejoin="round"/>',
};
function icon(name, cls = "ic") {
    return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">${ICONS[name] || ""}</svg>`;
}

function t(key) {
    return (window.AstaI18n && window.AstaI18n.t(key)) || key;
}

/* ------------------------------------------------------------------- *
 * Shell: sidebar + topbar. Every page still calls renderShell(path,
 * title) exactly as before; the shell now also kicks off a single
 * shared status/notifications poll used by the topbar.
 * ------------------------------------------------------------------- */
const NAV_GROUPS = [
    { labelKey: "navMain", links: [
        ["/", "navOverview", "overview", null],
        ["/statistics", "navStatistics", "stats", "stats.view"],
        ["/plugins", "navPlugins", "plugins", "plugins.view"],
        ["/logs", "navLogs", "logs", "logs.view"],
        ["/controls", "navControls", "controls", "plugins.manage"],
        ["/settings", "navSettings", "settings", "settings.view"],
    ]},
    { labelKey: "navAdminTools", links: [
        ["/alerts", "navAlerts", "alerts", "alerts.view"],
        ["/scheduler", "navScheduler", "scheduler", "scheduler.manage"],
        ["/backups", "navBackups", "backups", "backups.manage"],
        ["/audit", "navAudit", "audit", "audit.view"],
        ["/users", "navUsers", "users", "users.manage"],
    ]},
    { labelKey: "navAccount", links: [
        ["/account", "navAccountSecurity", "account", null],
    ]},
];

let shellPollTimer = null;
let lastNotificationId = 0;
let notifCache = [];

function renderShell(activePath, title) {
    const navHtml = NAV_GROUPS.map((group) => {
        let links = group.links.filter(([, , , perm]) => !perm || can(perm));
        // A pending (unapproved) account has no permissions at all - only
        // ever show it the Account group, regardless of any null-permission
        // links (like Overview) that would otherwise always show.
        if (CURRENT_ROLE === "pending" && group.labelKey !== "navAccount") links = [];
        if (!links.length) return "";
        return `
        <div class="nav-group">
            <div class="nav-group-label">${escapeHtml(t(group.labelKey))}</div>
            ${links.map(([href, labelKey, iconName]) => `
                <a href="${href}" class="nav-link ${href === activePath ? "active" : ""}">
                    ${icon(iconName)}<span>${escapeHtml(t(labelKey))}</span>
                </a>`).join("")}
        </div>`;
    }).join("");

    document.body.innerHTML = `
    <div class="drawer-overlay" id="drawerOverlay"></div>
    <div class="layout">
      <div class="sidebar" id="sidebar">
        <div class="brand">
          <div class="brand-mark">⚙️</div>
          <div>
            <div class="brand-name">${escapeHtml(t("brandName"))}</div>
            <div class="brand-sub">${escapeHtml(t("brandSub"))}</div>
          </div>
        </div>
        <div class="sidebar-scroll">${navHtml}</div>
        <div class="sidebar-foot">Asta Dashboard · Stage 10</div>
      </div>
      <div class="main">
        <div class="offline-banner" id="offlineBanner">
          ${icon("alerts", "ic")}<span>${escapeHtml(t("offlineBanner"))}</span>
        </div>
        <div class="topbar">
          <div class="topbar-left">
            <button class="hamburger" id="hamburgerBtn" aria-label="${escapeHtml(t('toggleMenu'))}">${icon("menu")}</button>
            <div class="page-title">${escapeHtml(title)}</div>
          </div>
          <div class="topbar-right">
            <div class="status-pill" id="statusPill" title="${escapeHtml(t('botConnectionStatus'))}">
              <span class="status-dot" id="statusDot"></span>
              <span id="statusText">${escapeHtml(t("checking"))}</span>
            </div>
            <div class="chip" id="uptimeChip">${icon("uptime", "ic")}<span id="uptimeText">–</span></div>
            <div class="chip" id="connChip">${icon("link", "ic")}<span id="connText">–</span></div>
            <button class="icon-btn" id="themeToggleBtn" title="${escapeHtml(t("themeToggle"))}">${window.AstaTheme && window.AstaTheme.get() === "light" ? "🌙" : "☀️"}</button>
            <button class="icon-btn" id="langToggleBtn" title="${escapeHtml(t("langToggle"))}" style="font-size:11.5px;font-weight:700;">${window.AstaI18n && window.AstaI18n.get() === "ar" ? "EN" : "AR"}</button>
            <div class="dropdown-wrap">
              <button class="icon-btn" id="notifBtn" title="${escapeHtml(t("notifications"))}">
                ${icon("bell")}
                <span class="dot-badge" id="notifBadge" style="display:none">0</span>
              </button>
              <div class="dropdown" id="notifDropdown">
                <div class="dropdown-head"><span>${escapeHtml(t("notifications"))}</span></div>
                <div id="notifList"><div class="dropdown-empty">${escapeHtml(t("loading"))}</div></div>
              </div>
            </div>
            <div class="dropdown-wrap">
              <button class="user-btn" id="userBtn">
                <span class="avatar" id="userAvatar">?</span>
                <span id="userName">…</span>
              </button>
              <div class="dropdown" id="userDropdown" style="width:200px;">
                <div class="dropdown-item" style="border-bottom:none;">
                  <div style="font-weight:700;color:var(--text);" id="userDropdownName">…</div>
                  <div style="margin-top:4px;"><span class="badge info" id="userRoleBadge">…</span></div>
                </div>
                <div class="dropdown-item" style="border-top:1px solid var(--border);">
                  <a href="/account" style="color:var(--text-dim);text-decoration:none;font-size:12.5px;">${escapeHtml(t("navAccountSecurity"))}</a>
                </div>
                <div class="dropdown-foot">
                  <button class="secondary" id="logoutBtn" style="display:flex;align-items:center;justify-content:center;gap:7px;">${icon("logout", "ic")}${escapeHtml(t("logout"))}</button>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="content" id="content"></div>
      </div>
    </div>`;

    document.getElementById("logoutBtn").addEventListener("click", logout);
    document.getElementById("themeToggleBtn").addEventListener("click", () => {
        const next = window.AstaTheme.toggle();
        document.getElementById("themeToggleBtn").textContent = next === "light" ? "🌙" : "☀️";
    });
    document.getElementById("langToggleBtn").addEventListener("click", () => {
        window.AstaI18n.toggle();
        // Nav labels, direction, and topbar chrome all depend on the
        // current language; a full reload is the simplest way to keep
        // every already-rendered page (each with its own inline script)
        // consistent, rather than threading a re-render callback through
        // all thirteen pages individually.
        window.location.reload();
    });

    // Mobile drawer
    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("drawerOverlay");
    const openDrawer = () => { sidebar.classList.add("open"); overlay.classList.add("show"); };
    const closeDrawer = () => { sidebar.classList.remove("open"); overlay.classList.remove("show"); };
    document.getElementById("hamburgerBtn").addEventListener("click", openDrawer);
    overlay.addEventListener("click", closeDrawer);

    // Dropdowns
    wireDropdown("notifBtn", "notifDropdown");
    wireDropdown("userBtn", "userDropdown");

    if (CURRENT_USER) {
        document.getElementById("userName").textContent = CURRENT_USER;
        document.getElementById("userDropdownName").textContent = CURRENT_USER;
        document.getElementById("userAvatar").textContent = initials(CURRENT_USER);
        const roleBadge = document.getElementById("userRoleBadge");
        if (roleBadge) roleBadge.textContent = CURRENT_ROLE_LABEL || CURRENT_ROLE || "";
    }

    startShellPoll();
    return document.getElementById("content");
}

function wireDropdown(btnId, dropId) {
    const btn = document.getElementById(btnId);
    const drop = document.getElementById(dropId);
    btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const willOpen = !drop.classList.contains("open");
        document.querySelectorAll(".dropdown.open").forEach((d) => d.classList.remove("open"));
        if (willOpen) drop.classList.add("open");
    });
    document.addEventListener("click", () => drop.classList.remove("open"));
    drop.addEventListener("click", (e) => e.stopPropagation());
}

function renderNotifDropdown(items) {
    const list = document.getElementById("notifList");
    if (!list) return;
    if (!items || !items.length) {
        list.innerHTML = `<div class="dropdown-empty">${escapeHtml(t("noNotificationsYet"))}</div>`;
        return;
    }
    list.innerHTML = items.slice().reverse().slice(0, 12).map((n) => `
        <div class="dropdown-item">
            <div>${escapeHtml(n.text)}</div>
            <div class="when">${fmtRelative(n.createdAt)}</div>
        </div>`).join("");
}

function applyStatusToShell(status, health) {
    const dot = document.getElementById("statusDot");
    const text = document.getElementById("statusText");
    const uptimeText = document.getElementById("uptimeText");
    const connText = document.getElementById("connText");
    const banner = document.getElementById("offlineBanner");
    if (!dot) return;

    const online = !!status?.online;
    dot.className = "status-dot " + (online ? "on" : "off");
    text.textContent = online ? t("online") : t("offline");
    if (uptimeText && status) uptimeText.textContent = fmtUptime(status.uptimeSeconds);
    if (connText && health) connText.textContent = health.connectionStatus === "connected" ? t("connected") : t("disconnected");
    if (banner) banner.classList.toggle("show", !online);
}

function showShellUnreachable(isUnreachable) {
    const banner = document.getElementById("offlineBanner");
    if (!banner) return;
    if (isUnreachable) {
        banner.classList.add("show");
        banner.querySelector("span").textContent = t("offlineBanner");
    }
}

async function pollShell() {
    try {
        const [{ status }, healthRes, notifRes] = await Promise.all([
            api("/api/status"),
            api("/api/health").catch(() => ({ health: null })),
            api("/api/notifications" + (lastNotificationId ? `?since=${lastNotificationId}` : "")).catch(() => null),
        ]);
        applyStatusToShell(status, healthRes.health);

        if (notifRes) {
            if (lastNotificationId && notifRes.items && notifRes.items.length) {
                notifCache = [...notifCache, ...notifRes.items].slice(-50);
            } else if (!lastNotificationId) {
                notifCache = notifRes.items || [];
            }
            if (notifRes.latestId) lastNotificationId = notifRes.latestId;
            const badge = document.getElementById("notifBadge");
            if (badge) {
                const unread = notifRes.items ? notifRes.items.length : 0;
                if (unread > 0 && lastNotificationId) {
                    badge.style.display = "flex";
                    badge.textContent = unread > 9 ? "9+" : String(unread);
                }
            }
            renderNotifDropdown(notifCache);
        }
    } catch (e) {
        if (e.offline) showShellUnreachable(true);
    }
}

function startShellPoll() {
    if (shellPollTimer) clearInterval(shellPollTimer);
    pollShell();
    shellPollTimer = setInterval(pollShell, 5000);
}

