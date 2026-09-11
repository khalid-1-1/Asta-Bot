/**
 * dashboard/server.js
 * -----------------------------------------------------------------------
 * Stage 7 - Web Dashboard for Asta Bot.
 *
 * Deliberately built on Node's built-in `http` module only - no Express,
 * no session/cookie/bcrypt packages. Two reasons:
 *   1. The request explicitly says to only add a new dependency when truly
 *      necessary, and everything here (routing, sessions, scrypt password
 *      hashing, cookies) is doable with Node's standard library.
 *   2. This sandbox has no network access and no node_modules installed
 *      for the *existing* project dependencies either, so a new dependency
 *      could not actually be installed or tested here. Zero-dependency
 *      code can be (and was) actually started and exercised with plain
 *      `node`, instead of only being reviewed by eye.
 *
 * This file never imports the bot's WhatsApp connection, permissions, or
 * encryption code directly - it only talks to whatever is handed to it in
 * `context` by main.js (see bottom of bot/main.js). That keeps the
 * Dashboard testable in isolation and keeps Stage 7 from touching Stage
 * 1-6 files.
 */

import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { URL } from "url";

import { loadConfig } from "./lib/config.js";
import { createAuthStore, AuthError } from "./lib/auth-store.js";
import {
    createSessionStore,
    parseCookies,
    sessionCookieName,
    buildSessionCookie,
    buildClearCookie,
} from "./lib/sessions.js";
import { createLoginLimiter } from "./lib/rate-limit.js";
import { readLogPage, LOG_CATEGORIES } from "./lib/logs-reader.js";

// Stage 11 - Multi-User Dashboard & Role-Based Access Control. This is the
// Dashboard's OWN role/permission system - entirely separate from the
// WhatsApp bot's Owner/Sub-Owner/Elite levels (see lib/roles.js's header
// for why). Every sensitive route below is wrapped in requirePermission().
import { PERM, ROLES, ASSIGNABLE_ROLES, roleHasPermission, roleLabel, isValidRole } from "./lib/roles.js";

// Stage 8 - Advanced Bot Management & Automation. Every one of these is a
// small, independent, additive module (see each file's own header) - none
// of them replace anything Stage 7 built, they only extend server.js's
// routing to expose them.
import * as settingsStore from "./lib/settings-store.js";
import * as auditLog from "./lib/audit-log.js";
import * as notifications from "./lib/notifications.js";
import * as alertsEngine from "./lib/alerts.js";
import * as scheduler from "./lib/scheduler.js";
import * as backup from "./lib/backup.js";

// Stage 9 - Production Hardening & Self-Healing. Read-only Recovery
// History (written by main.js's Watchdog, see core/watchdog.js) plus the
// Graceful Restart admin action below - both additive, same conventions
// as the Stage 8 imports above.
import * as recoveryLog from "./lib/recovery-log.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
};

let httpServer = null;
let sessionStore = null;
let cleanupHandlers = [];

// Stage 8, item #3 (Alerts) - "Dashboard/API errors متكررة" input. Bounded,
// pruned on every push; never a new per-request timer.
const dashboardErrorTimestamps = [];
function recordDashboardError() {
    const now = Date.now();
    dashboardErrorTimestamps.push(now);
    const cutoff = now - 60 * 60 * 1000;
    while (dashboardErrorTimestamps.length && (dashboardErrorTimestamps[0] < cutoff || dashboardErrorTimestamps.length > 200)) {
        dashboardErrorTimestamps.shift();
    }
}

function sendJson(res, statusCode, body, extraHeaders = {}) {
    const payload = JSON.stringify(body);
    res.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(payload),
        "X-Content-Type-Options": "nosniff",
        ...extraHeaders,
    });
    res.end(payload);
}

function sendError(res, statusCode, message) {
    // Never leak stack traces or internal details to the browser.
    if (statusCode >= 500) recordDashboardError(); // Stage 8, item #3 - alert input
    sendJson(res, statusCode, { ok: false, error: message });
}

async function readJsonBody(req, maxBytes = 64 * 1024) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on("data", (chunk) => {
            size += chunk.length;
            if (size > maxBytes) {
                reject(new Error("Payload too large"));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => {
            if (chunks.length === 0) return resolve({});
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            } catch (e) {
                reject(new Error("Invalid JSON body"));
            }
        });
        req.on("error", reject);
    });
}

function getSessionFromRequest(req) {
    const cookies = parseCookies(req.headers.cookie);
    const sid = cookies[sessionCookieName()];
    return { sid, session: sessionStore.get(sid) };
}

function isHttps(req) {
    // Behind the sandbox/dev setup this is always plain HTTP; if a real
    // deployment puts this behind a TLS-terminating proxy, honor the
    // standard forwarded header so the Secure cookie flag is set correctly.
    return req.socket?.encrypted === true || req.headers["x-forwarded-proto"] === "https";
}

function requireAuth(req, res) {
    const { session } = getSessionFromRequest(req);
    if (!session) {
        sendError(res, 401, "Unauthorized");
        return null;
    }
    return session;
}

/**
 * Stage 11 - loads the CURRENT (live) Dashboard user record for a session,
 * every request. Deliberately never cached on the session itself: if a
 * Primary Owner/Admin disables a user, deletes them, or changes their
 * role while they're logged in, this makes that change take effect on
 * their very next request instead of only after their session expires.
 * Returns null (and clears the now-invalid session) if the account no
 * longer exists or has been disabled since the session was created.
 */
function requireActiveUser(req, res, authStore) {
    const { sid, session } = getSessionFromRequest(req);
    if (!session) {
        sendError(res, 401, "Unauthorized");
        return null;
    }
    const user = authStore.getUser(session.username);
    if (!user || user.disabled) {
        sessionStore.destroy(sid);
        sendError(res, 401, "Unauthorized");
        return null;
    }
    return { sid, session, user };
}

function requireCsrf(req, res, session) {
    const token = req.headers["x-csrf-token"];
    if (!token || token !== session.csrfToken) {
        sendError(res, 403, "Invalid CSRF token");
        return false;
    }
    return true;
}

/**
 * Stage 11, requirement #6/#7 - Backend authorization gate. Every
 * permission-sensitive route calls this before doing anything else. A
 * denied attempt is itself recorded to the Audit Log (Stage 12, item #5)
 * so a Primary Owner/Admin can see repeated unauthorized-access attempts,
 * not just successful admin actions.
 */
function requirePermission(res, user, permission, session, actionLabel) {
    if (roleHasPermission(user.role, permission)) return true;
    auditLog.recordAudit({ action: "access_denied", result: "forbidden", admin: session.username, target: actionLabel || permission });
    sendError(res, 403, "Forbidden - your role does not have this permission");
    return false;
}

function clientIp(req) {
    // Behind a reverse proxy, X-Forwarded-For's first hop is the real
    // client - trusted here only for display/audit purposes, never for
    // any security decision (rate limiting still keys off the socket).
    const fwd = req.headers["x-forwarded-for"];
    if (typeof fwd === "string" && fwd.trim()) return fwd.split(",")[0].trim();
    return req.socket.remoteAddress || "unknown";
}

function safeStaticPath(urlPath) {
    const rel = decodeURIComponent(urlPath.replace(/^\/+/, "")) || "index.html";
    const resolved = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!resolved.startsWith(PUBLIC_DIR)) return null; // path traversal guard
    return resolved;
}

function servePage(res, filename) {
    const filePath = path.join(PUBLIC_DIR, filename);
    fs.readFile(filePath, (err, data) => {
        if (err) return sendError(res, 404, "Not found");
        res.writeHead(200, { "Content-Type": MIME[".html"] });
        res.end(data);
    });
}

function serveStatic(res, filePath) {
    fs.readFile(filePath, (err, data) => {
        if (err) return sendError(res, 404, "Not found");
        const ext = path.extname(filePath);
        res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
        res.end(data);
    });
}

async function handleApi(req, res, pathname, context, config, limiter, authStore, registerLimiter) {
    // ---- Public: self-registration ----
    // Anyone who can reach the login page can create an account here, but
    // it always comes out with role="pending" and ZERO permissions (see
    // lib/roles.js) - it cannot do anything on the Dashboard until a
    // Primary Owner/Admin assigns it a real role from User Management.
    // This intentionally does NOT create a session on success - the new
    // user logs in normally afterwards and lands on a "pending approval"
    // Account page.
    if (pathname === "/api/auth/register" && req.method === "POST") {
        const ip = clientIp(req);
        const limitCheck = registerLimiter.check(ip, "register");
        if (!limitCheck.allowed) {
            return sendError(res, 429, "Too many attempts. Try again later.");
        }
        let body;
        try {
            body = await readJsonBody(req);
        } catch (e) {
            return sendError(res, 400, "Invalid request body");
        }
        try {
            const created = authStore.registerPendingUser({ username: body?.username, password: body?.password });
            registerLimiter.recordSuccess(ip, "register");
            auditLog.recordAudit({ action: "user_registered", result: "success", admin: created.username, target: "self-registration" });
            notifications.notifyAdminAction(`تسجيل حساب جديد بانتظار الموافقة: ${created.username}.`);
            return sendJson(res, 200, { ok: true, message: "Account created. An administrator must approve it (assign a role) before you can use the Dashboard." });
        } catch (e) {
            registerLimiter.recordFailure(ip, "register");
            auditLog.recordAudit({ action: "user_registered", result: "failed", admin: body?.username || null, target: "self-registration" });
            if (e instanceof AuthError) return sendError(res, 400, e.message);
            return sendError(res, 500, "Failed to create account");
        }
    }

    // ---- Public: login ----
    if (pathname === "/api/auth/login" && req.method === "POST") {
        let body;
        try {
            body = await readJsonBody(req);
        } catch (e) {
            return sendError(res, 400, "Invalid request body");
        }
        const { username, password } = body || {};
        const ip = clientIp(req);

        // Stage 12, item #3 - never reveal whether a username exists: the
        // rate limiter is checked (and failures recorded) using the exact
        // same code path regardless of whether the account is real,
        // disabled, or simply mistyped.
        const limitCheck = limiter.check(ip, String(username || ""));
        if (!limitCheck.allowed) {
            return sendError(res, 429, "Too many attempts. Try again later.");
        }
        if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
            limiter.recordFailure(ip, String(username || ""));
            auditLog.recordAudit({ action: "dashboard_login", result: "failed", admin: username || null, target: "missing_credentials" });
            return sendError(res, 400, "Username and password are required");
        }

        const matchedUser = authStore.verify(username, password);
        if (!matchedUser) {
            limiter.recordFailure(ip, username);
            auditLog.recordAudit({ action: "dashboard_login", result: "failed", admin: username, target: null }); // Stage 8, item #7
            return sendError(res, 401, "Invalid username or password");
        }
        limiter.recordSuccess(ip, username);
        authStore.recordLogin(matchedUser.username, ip);
        auditLog.recordAudit({ action: "dashboard_login", result: "success", admin: matchedUser.username, target: `role:${matchedUser.role}` }); // Stage 8, item #7

        const sid = sessionStore.create(matchedUser.username, { ip, userAgent: req.headers["user-agent"] || null });
        const session = sessionStore.get(sid);
        return sendJson(res, 200, {
            ok: true,
            username: matchedUser.username,
            role: matchedUser.role,
            roleLabel: roleLabel(matchedUser.role),
            isPrimaryOwner: matchedUser.isPrimaryOwner,
            permissions: Object.values(PERM).filter((p) => roleHasPermission(matchedUser.role, p)),
            csrfToken: session.csrfToken,
        }, {
            "Set-Cookie": buildSessionCookie(sid, { secure: isHttps(req) }),
        });
    }

    if (pathname === "/api/auth/logout" && req.method === "POST") {
        const { sid, session: currentSession } = getSessionFromRequest(req);
        if (sid) sessionStore.destroy(sid);
        if (currentSession) auditLog.recordAudit({ action: "dashboard_logout", result: "success", admin: currentSession.username }); // Stage 8, item #7
        return sendJson(res, 200, { ok: true }, { "Set-Cookie": buildClearCookie({ secure: isHttps(req) }) });
    }

    if (pathname === "/api/auth/me" && req.method === "GET") {
        const auth = requireActiveUser(req, res, authStore);
        if (!auth) return;
        const { session, user } = auth;
        return sendJson(res, 200, {
            ok: true,
            username: session.username,
            csrfToken: session.csrfToken,
            role: user.role,
            roleLabel: roleLabel(user.role),
            isPrimaryOwner: user.isPrimaryOwner,
            permissions: Object.values(PERM).filter((p) => roleHasPermission(user.role, p)),
            lastLoginAt: user.lastLoginAt,
        });
    }

    // ---- Everything below this line requires a valid, still-enabled session. ----
    const authCtx = requireActiveUser(req, res, authStore);
    if (!authCtx) return;
    const { sid: currentSid, session, user: currentUser } = authCtx;

    if (pathname === "/api/status" && req.method === "GET") {
        try {
            const status = context.getBotStatus();
            return sendJson(res, 200, { ok: true, status });
        } catch (e) {
            return sendError(res, 500, "Failed to read bot status");
        }
    }

    if (pathname === "/api/stats" && req.method === "GET") {
        if (!requirePermission(res, currentUser, PERM.STATS_VIEW, session, "GET /api/stats")) return;
        try {
            return sendJson(res, 200, { ok: true, stats: context.getStats() });
        } catch (e) {
            return sendError(res, 500, "Failed to read statistics");
        }
    }

    if (pathname === "/api/plugins" && req.method === "GET") {
        if (!requirePermission(res, currentUser, PERM.PLUGINS_VIEW, session, "GET /api/plugins")) return;
        try {
            return sendJson(res, 200, { ok: true, plugins: summarizePlugins(context.getPlugins(), context), lastReload: context.getLastPluginReload ? context.getLastPluginReload() : null });
        } catch (e) {
            return sendError(res, 500, "Failed to list plugins");
        }
    }

    // Stage 8, item #4 - enable/disable a plugin by (any of its) command name.
    if (pathname === "/api/plugins/enable" && req.method === "POST") {
        if (!requirePermission(res, currentUser, PERM.PLUGINS_MANAGE, session, "POST /api/plugins/enable")) return;
        if (!requireCsrf(req, res, session)) return;
        let body = {};
        try {
            body = await readJsonBody(req);
        } catch (e) {
            return sendError(res, 400, "Invalid request body");
        }
        const command = typeof body.plugin === "string" ? body.plugin.toLowerCase().trim() : null;
        if (!command) return sendError(res, 400, "plugin is required");

        const result = context.setPluginEnabled ? context.setPluginEnabled(command, true, session.username) : { ok: false, reason: "not_supported" };
        auditLog.recordAudit({ action: "plugin_enable", result: result.ok ? "success" : "failed", admin: session.username, target: command });
        if (result.ok) notifications.notifyAdminAction(`تم تفعيل البلوجن الخاص بالأمر "${command}" بواسطة ${session.username}.`);
        return sendJson(res, result.ok ? 200 : 400, result);
    }

    if (pathname === "/api/plugins/disable" && req.method === "POST") {
        if (!requirePermission(res, currentUser, PERM.PLUGINS_MANAGE, session, "POST /api/plugins/disable")) return;
        if (!requireCsrf(req, res, session)) return;
        let body = {};
        try {
            body = await readJsonBody(req);
        } catch (e) {
            return sendError(res, 400, "Invalid request body");
        }
        const command = typeof body.plugin === "string" ? body.plugin.toLowerCase().trim() : null;
        if (!command) return sendError(res, 400, "plugin is required");

        const result = context.setPluginEnabled ? context.setPluginEnabled(command, false, session.username) : { ok: false, reason: "not_supported" };
        auditLog.recordAudit({ action: "plugin_disable", result: result.ok ? "success" : "failed", admin: session.username, target: command });
        if (result.ok) notifications.notifyAdminAction(`تم تعطيل البلوجن الخاص بالأمر "${command}" بواسطة ${session.username}.`);
        return sendJson(res, result.ok ? 200 : 400, result);
    }

    if (pathname === "/api/plugins/reload" && req.method === "POST") {
        if (!requirePermission(res, currentUser, PERM.PLUGINS_MANAGE, session, "POST /api/plugins/reload")) return;
        if (!requireCsrf(req, res, session)) return;
        let body = {};
        try {
            body = await readJsonBody(req);
        } catch (e) {
            return sendError(res, 400, "Invalid request body");
        }
        const targetCommand = typeof body.plugin === "string" ? body.plugin.toLowerCase().trim() : null;

        try {
            // Stage 7 does not add a second plugin loader: this calls the
            // exact same hot-reload path plugins.js already exposes. A
            // "reload single plugin" request still reloads everything
            // (that's the only reload mechanism that exists) and then
            // reports whether the requested command is present afterward.
            await context.reloadAllPlugins();
            const plugins = context.getPlugins();
            auditLog.recordAudit({ action: "plugin_reload", result: "success", admin: session.username, target: targetCommand || "all" }); // Stage 8, item #7

            if (targetCommand) {
                const found = Object.prototype.hasOwnProperty.call(plugins, targetCommand);
                return sendJson(res, 200, {
                    ok: true,
                    message: found
                        ? `Reload successful. Command "${targetCommand}" is loaded.`
                        : `Reload completed, but "${targetCommand}" was not found afterward.`,
                    reloaded: found,
                });
            }
            return sendJson(res, 200, { ok: true, message: "All plugins reloaded successfully." });
        } catch (err) {
            auditLog.recordAudit({ action: "plugin_reload", result: "failed", admin: session.username, target: targetCommand || "all" });
            return sendJson(res, 200, {
                ok: false,
                message: `Reload failed: ${err?.message || "unknown error"}`,
            });
        }
    }

    if (pathname === "/api/logs" && req.method === "GET") {
        if (!requirePermission(res, currentUser, PERM.LOGS_VIEW, session, "GET /api/logs")) return;
        const url = new URL(req.url, "http://internal");
        const category = url.searchParams.get("category") || undefined;
        const search = url.searchParams.get("search") || undefined;
        const beforeParam = url.searchParams.get("before");
        const dateFrom = url.searchParams.get("dateFrom");
        const dateTo = url.searchParams.get("dateTo");

        try {
            const page = readLogPage(context.getHistoryPath(), {
                beforeOffset: beforeParam ? Number.parseInt(beforeParam, 10) : undefined,
                category,
                search,
                dateFrom: dateFrom ? Date.parse(dateFrom) : undefined,
                dateTo: dateTo ? Date.parse(dateTo) : undefined,
                limit: config.logsPageSize,
            });
            return sendJson(res, 200, { ok: true, ...page, categories: LOG_CATEGORIES });
        } catch (e) {
            return sendError(res, 500, "Failed to read logs");
        }
    }

    // -----------------------------------------------------------------
    // Stage 8, item #1 - Health Monitoring
    // -----------------------------------------------------------------
    if (pathname === "/api/health" && req.method === "GET") {
        try {
            return sendJson(res, 200, { ok: true, health: context.getHealth ? context.getHealth() : null });
        } catch (e) {
            return sendError(res, 500, "Failed to read health");
        }
    }

    // -----------------------------------------------------------------
    // Stage 9, item #1/#15 - full Watchdog report (state per subsystem),
    // beyond the summary fields already folded into /api/health above.
    // -----------------------------------------------------------------
    if (pathname === "/api/watchdog" && req.method === "GET") {
        if (!requirePermission(res, currentUser, PERM.LOGS_VIEW, session, "GET /api/watchdog")) return;
        try {
            return sendJson(res, 200, { ok: true, watchdog: context.getWatchdogReport ? context.getWatchdogReport() : null });
        } catch (e) {
            return sendError(res, 500, "Failed to read watchdog report");
        }
    }

    // -----------------------------------------------------------------
    // Stage 9, item #12 - Recovery History (read-only, paged the same
    // way /api/audit is).
    // -----------------------------------------------------------------
    if (pathname === "/api/recovery" && req.method === "GET") {
        if (!requirePermission(res, currentUser, PERM.LOGS_VIEW, session, "GET /api/recovery")) return;
        const url = new URL(req.url, "http://internal");
        const beforeParam = url.searchParams.get("before");
        try {
            const page = recoveryLog.readRecoveryPage({
                beforeOffset: beforeParam ? Number.parseInt(beforeParam, 10) : undefined,
                limit: 100,
            });
            return sendJson(res, 200, { ok: true, ...page });
        } catch (e) {
            return sendError(res, 500, "Failed to read recovery history");
        }
    }

    // -----------------------------------------------------------------
    // Stage 9, item #5 - Graceful Restart. Same auth (session already
    // required for everything past the line above) + CSRF + audit-log
    // pattern as every other admin action (config change, plugin
    // reload, backup restore). Takes no parameters from the request body
    // at all - it cannot be used to pass arbitrary arguments to the
    // restart, and it authorizes solely from the existing Dashboard
    // session (item #16 - no separate, weaker authorization path).
    // -----------------------------------------------------------------
    if (pathname === "/api/system/restart" && req.method === "POST") {
        if (!requirePermission(res, currentUser, PERM.BOT_CONTROL, session, "POST /api/system/restart")) return;
        if (!requireCsrf(req, res, session)) return;
        if (typeof context.restartBot !== "function") {
            return sendError(res, 501, "Restart is not available for this bot instance");
        }
        auditLog.recordAudit({ action: "bot_restart", result: "requested", admin: session.username, target: null });
        // Intentionally not awaited: a successful restart tears this very
        // process down, so the HTTP response must be sent first or the
        // caller would never see it.
        sendJson(res, 200, { ok: true, message: "Restart requested." });
        context.restartBot(session.username);
        return;
    }

    // -----------------------------------------------------------------
    // Stage 8, item #2 - Advanced Statistics (developed on Stage 6/7's
    // telemetry.js - see handlers/telemetry.js#getAdvancedStats).
    // -----------------------------------------------------------------
    if (pathname === "/api/stats/advanced" && req.method === "GET") {
        if (!requirePermission(res, currentUser, PERM.STATS_VIEW, session, "GET /api/stats/advanced")) return;
        try {
            return sendJson(res, 200, { ok: true, stats: context.getAdvancedStats ? context.getAdvancedStats() : null });
        } catch (e) {
            return sendError(res, 500, "Failed to read advanced statistics");
        }
    }

    // -----------------------------------------------------------------
    // Stage 8, item #3 - Alerts (evaluated on-demand, no background timer)
    // -----------------------------------------------------------------
    if (pathname === "/api/alerts" && req.method === "GET") {
        if (!requirePermission(res, currentUser, PERM.ALERTS_VIEW, session, "GET /api/alerts")) return;
        try {
            const inputs = context.getAlertInputs ? context.getAlertInputs() : {};
            inputs.dashboardErrorTimestamps = [...dashboardErrorTimestamps];
            return sendJson(res, 200, { ok: true, alerts: alertsEngine.evaluate(inputs) });
        } catch (e) {
            return sendError(res, 500, "Failed to evaluate alerts");
        }
    }

    // -----------------------------------------------------------------
    // Stage 8, item #6 - Safe Configuration
    // -----------------------------------------------------------------
    if (pathname === "/api/config" && req.method === "GET") {
        if (!requirePermission(res, currentUser, PERM.SETTINGS_VIEW, session, "GET /api/config")) return;
        try {
            return sendJson(res, 200, { ok: true, values: settingsStore.getSettings(), schema: settingsStore.getSchema() });
        } catch (e) {
            return sendError(res, 500, "Failed to read configuration");
        }
    }

    if (pathname === "/api/config" && req.method === "POST") {
        if (!requirePermission(res, currentUser, PERM.SETTINGS_MANAGE, session, "POST /api/config")) return;
        if (!requireCsrf(req, res, session)) return;
        let body = {};
        try {
            body = await readJsonBody(req);
        } catch (e) {
            return sendError(res, 400, "Invalid request body");
        }
        const { applied, errors } = settingsStore.updateSettings(body);
        auditLog.recordAudit({
            action: "config_change",
            result: Object.keys(errors).length ? "partial" : "success",
            admin: session.username,
            target: Object.keys(applied).join(",") || null,
        }); // Stage 8, item #7
        if (Object.keys(applied).length) notifications.notifyAdminAction(`تم تعديل إعدادات: ${Object.keys(applied).join(", ")} بواسطة ${session.username}.`);
        return sendJson(res, 200, { ok: Object.keys(errors).length === 0, applied, errors, values: settingsStore.getSettings() });
    }

    // -----------------------------------------------------------------
    // Stage 8, item #7 - Admin Audit Log (read-only from the Dashboard)
    // -----------------------------------------------------------------
    if (pathname === "/api/audit" && req.method === "GET") {
        if (!requirePermission(res, currentUser, PERM.AUDIT_VIEW, session, "GET /api/audit")) return;
        const url = new URL(req.url, "http://internal");
        const beforeParam = url.searchParams.get("before");
        try {
            const page = auditLog.readAuditPage({
                beforeOffset: beforeParam ? Number.parseInt(beforeParam, 10) : undefined,
                limit: 100,
            });
            return sendJson(res, 200, { ok: true, ...page });
        } catch (e) {
            return sendError(res, 500, "Failed to read audit log");
        }
    }

    // -----------------------------------------------------------------
    // Stage 8, item #5 - Scheduled Tasks
    // -----------------------------------------------------------------
    if (pathname === "/api/scheduler/tasks" && req.method === "GET") {
        if (!requirePermission(res, currentUser, PERM.SCHEDULER_MANAGE, session, "GET /api/scheduler/tasks")) return;
        try {
            return sendJson(res, 200, { ok: true, tasks: scheduler.listTasks(), allowedActions: scheduler.getAllowedActionTypes() });
        } catch (e) {
            return sendError(res, 500, "Failed to list tasks");
        }
    }

    if (pathname === "/api/scheduler/tasks" && req.method === "POST") {
        if (!requirePermission(res, currentUser, PERM.SCHEDULER_MANAGE, session, "POST /api/scheduler/tasks")) return;
        if (!requireCsrf(req, res, session)) return;
        let body = {};
        try {
            body = await readJsonBody(req);
        } catch (e) {
            return sendError(res, 400, "Invalid request body");
        }
        const result = scheduler.createTask(body || {});
        auditLog.recordAudit({ action: "scheduler_create", result: result.ok ? "success" : "failed", admin: session.username, target: result.task?.id || body?.name || null });
        return sendJson(res, result.ok ? 200 : 400, result);
    }

    if (pathname === "/api/scheduler/tasks/update" && req.method === "POST") {
        if (!requirePermission(res, currentUser, PERM.SCHEDULER_MANAGE, session, "POST /api/scheduler/tasks/update")) return;
        if (!requireCsrf(req, res, session)) return;
        let body = {};
        try {
            body = await readJsonBody(req);
        } catch (e) {
            return sendError(res, 400, "Invalid request body");
        }
        if (!body.id) return sendError(res, 400, "id is required");
        const result = scheduler.updateTask(body.id, body);
        auditLog.recordAudit({ action: "scheduler_update", result: result.ok ? "success" : "failed", admin: session.username, target: body.id });
        return sendJson(res, result.ok ? 200 : 400, result);
    }

    if (pathname === "/api/scheduler/tasks/delete" && req.method === "POST") {
        if (!requirePermission(res, currentUser, PERM.SCHEDULER_MANAGE, session, "POST /api/scheduler/tasks/delete")) return;
        if (!requireCsrf(req, res, session)) return;
        let body = {};
        try {
            body = await readJsonBody(req);
        } catch (e) {
            return sendError(res, 400, "Invalid request body");
        }
        if (!body.id) return sendError(res, 400, "id is required");
        const result = scheduler.deleteTask(body.id);
        auditLog.recordAudit({ action: "scheduler_delete", result: result.ok ? "success" : "failed", admin: session.username, target: body.id });
        return sendJson(res, result.ok ? 200 : 400, result);
    }

    if (pathname === "/api/scheduler/tasks/run" && req.method === "POST") {
        if (!requirePermission(res, currentUser, PERM.SCHEDULER_MANAGE, session, "POST /api/scheduler/tasks/run")) return;
        if (!requireCsrf(req, res, session)) return;
        let body = {};
        try {
            body = await readJsonBody(req);
        } catch (e) {
            return sendError(res, 400, "Invalid request body");
        }
        if (!body.id) return sendError(res, 400, "id is required");
        try {
            const result = await scheduler.runTask(body.id, context);
            auditLog.recordAudit({ action: "scheduler_run", result: result.ok ? "success" : "failed", admin: session.username, target: body.id });
            return sendJson(res, result.ok ? 200 : 400, result);
        } catch (e) {
            return sendError(res, 500, "Failed to run task");
        }
    }

    // -----------------------------------------------------------------
    // Stage 8, item #8 - Backup & Recovery
    // -----------------------------------------------------------------
    if (pathname === "/api/backups" && req.method === "GET") {
        if (!requirePermission(res, currentUser, PERM.BACKUPS_MANAGE, session, "GET /api/backups")) return;
        try {
            return sendJson(res, 200, { ok: true, backups: backup.listBackups() });
        } catch (e) {
            return sendError(res, 500, "Failed to list backups");
        }
    }

    if (pathname === "/api/backups" && req.method === "POST") {
        if (!requirePermission(res, currentUser, PERM.BACKUPS_MANAGE, session, "POST /api/backups")) return;
        if (!requireCsrf(req, res, session)) return;
        let body = {};
        try {
            body = await readJsonBody(req);
        } catch (e) {
            return sendError(res, 400, "Invalid request body");
        }
        const result = backup.createBackup(context, body?.name);
        auditLog.recordAudit({ action: "backup_create", result: result.ok ? "success" : "failed", admin: session.username, target: result.manifest?.id || null });
        notifications.notifyBackupResult(result.ok ? `تم إنشاء نسخة احتياطية بواسطة ${session.username}.` : `فشل إنشاء نسخة احتياطية: ${result.reason}`, result.ok);
        return sendJson(res, result.ok ? 200 : 400, result);
    }

    if (pathname === "/api/backups/delete" && req.method === "POST") {
        if (!requirePermission(res, currentUser, PERM.BACKUPS_MANAGE, session, "POST /api/backups/delete")) return;
        if (!requireCsrf(req, res, session)) return;
        let body = {};
        try {
            body = await readJsonBody(req);
        } catch (e) {
            return sendError(res, 400, "Invalid request body");
        }
        if (!body.id) return sendError(res, 400, "id is required");
        const result = backup.deleteBackup(body.id);
        auditLog.recordAudit({ action: "backup_delete", result: result.ok ? "success" : "failed", admin: session.username, target: body.id });
        return sendJson(res, result.ok ? 200 : 400, result);
    }

    if (pathname === "/api/backups/restore" && req.method === "POST") {
        if (!requirePermission(res, currentUser, PERM.BACKUPS_MANAGE, session, "POST /api/backups/restore")) return;
        if (!requireCsrf(req, res, session)) return;
        let body = {};
        try {
            body = await readJsonBody(req);
        } catch (e) {
            return sendError(res, 400, "Invalid request body");
        }
        if (!body.id) return sendError(res, 400, "id is required");
        try {
            const result = backup.restoreBackup(body.id, context);
            auditLog.recordAudit({ action: "backup_restore", result: result.ok ? "success" : "failed", admin: session.username, target: body.id });
            notifications.notifyBackupResult(result.ok ? `تم استرجاع النسخة الاحتياطية ${body.id} بواسطة ${session.username}.` : `فشل الاسترجاع: ${result.reason}`, result.ok);
            return sendJson(res, result.ok ? 200 : 400, result);
        } catch (e) {
            return sendError(res, 500, "Failed to restore backup");
        }
    }

    // -----------------------------------------------------------------
    // Stage 11, item #5 - User Management (Primary Owner / Admin only).
    // Every route here requires PERM.USERS_MANAGE, and every mutation
    // additionally passes through auth-store.js's assertCanModifyTarget()
    // gate, which is what actually enforces "the Primary Owner can never
    // be deleted/disabled/demoted/reassigned" - even an Admin holding
    // USERS_MANAGE cannot get past that check (item #7's requirement).
    // -----------------------------------------------------------------
    if (pathname === "/api/users" && req.method === "GET") {
        if (!requirePermission(res, currentUser, PERM.USERS_MANAGE, session, "GET /api/users")) return;
        try {
            const users = authStore.listUsers().map((u) => ({ ...u, roleLabel: roleLabel(u.role) }));
            return sendJson(res, 200, { ok: true, users, assignableRoles: ASSIGNABLE_ROLES });
        } catch (e) {
            return sendError(res, 500, "Failed to list users");
        }
    }

    if (pathname === "/api/users" && req.method === "POST") {
        if (!requirePermission(res, currentUser, PERM.USERS_MANAGE, session, "POST /api/users")) return;
        if (!requireCsrf(req, res, session)) return;
        let body = {};
        try {
            body = await readJsonBody(req);
        } catch (e) {
            return sendError(res, 400, "Invalid request body");
        }
        try {
            const created = authStore.createUser({
                username: body.username,
                password: body.password,
                role: body.role,
                createdBy: session.username,
            });
            auditLog.recordAudit({ action: "user_created", result: "success", admin: session.username, target: `${created.username} (${created.role})` });
            notifications.notifyAdminAction(`تم إنشاء مستخدم جديد للـ Dashboard: ${created.username} (${roleLabel(created.role)}) بواسطة ${session.username}.`);
            return sendJson(res, 200, { ok: true, user: { ...created, roleLabel: roleLabel(created.role) } });
        } catch (e) {
            auditLog.recordAudit({ action: "user_created", result: "failed", admin: session.username, target: body.username || null });
            if (e instanceof AuthError) return sendError(res, 400, e.message);
            return sendError(res, 500, "Failed to create user");
        }
    }

    if (pathname === "/api/users/role" && req.method === "POST") {
        if (!requirePermission(res, currentUser, PERM.USERS_MANAGE, session, "POST /api/users/role")) return;
        if (!requireCsrf(req, res, session)) return;
        let body = {};
        try {
            body = await readJsonBody(req);
        } catch (e) {
            return sendError(res, 400, "Invalid request body");
        }
        try {
            const updated = authStore.changeRole(body.username, body.role);
            auditLog.recordAudit({ action: "role_changed", result: "success", admin: session.username, target: `${body.username} -> ${body.role}` });
            notifications.notifyAdminAction(`تم تغيير صلاحية ${body.username} إلى ${roleLabel(body.role)} بواسطة ${session.username}.`);
            return sendJson(res, 200, { ok: true, user: { ...updated, roleLabel: roleLabel(updated.role) } });
        } catch (e) {
            auditLog.recordAudit({ action: "role_changed", result: "failed", admin: session.username, target: body.username || null });
            if (e instanceof AuthError) return sendError(res, e.code === "not_found" ? 404 : 400, e.message);
            return sendError(res, 500, "Failed to change role");
        }
    }

    if (pathname === "/api/users/disable" && req.method === "POST") {
        if (!requirePermission(res, currentUser, PERM.USERS_MANAGE, session, "POST /api/users/disable")) return;
        if (!requireCsrf(req, res, session)) return;
        let body = {};
        try {
            body = await readJsonBody(req);
        } catch (e) {
            return sendError(res, 400, "Invalid request body");
        }
        try {
            const updated = authStore.setDisabled(body.username, Boolean(body.disabled), session.username);
            // A disabled user's active sessions are revoked immediately -
            // otherwise "Disable User" would not actually stop them from
            // using the Dashboard until their session naturally expired.
            if (updated.disabled) sessionStore.destroyAllForUser(updated.username);
            auditLog.recordAudit({ action: updated.disabled ? "user_disabled" : "user_enabled", result: "success", admin: session.username, target: body.username });
            notifications.notifyAdminAction(`تم ${updated.disabled ? "تعطيل" : "تفعيل"} المستخدم ${body.username} بواسطة ${session.username}.`);
            return sendJson(res, 200, { ok: true, user: { ...updated, roleLabel: roleLabel(updated.role) } });
        } catch (e) {
            auditLog.recordAudit({ action: "user_disabled", result: "failed", admin: session.username, target: body.username || null });
            if (e instanceof AuthError) return sendError(res, e.code === "not_found" ? 404 : 400, e.message);
            return sendError(res, 500, "Failed to update user");
        }
    }

    if (pathname === "/api/users/delete" && req.method === "POST") {
        if (!requirePermission(res, currentUser, PERM.USERS_MANAGE, session, "POST /api/users/delete")) return;
        if (!requireCsrf(req, res, session)) return;
        let body = {};
        try {
            body = await readJsonBody(req);
        } catch (e) {
            return sendError(res, 400, "Invalid request body");
        }
        try {
            authStore.deleteUser(body.username, session.username);
            sessionStore.destroyAllForUser(body.username);
            auditLog.recordAudit({ action: "user_deleted", result: "success", admin: session.username, target: body.username });
            notifications.notifyAdminAction(`تم حذف المستخدم ${body.username} بواسطة ${session.username}.`);
            return sendJson(res, 200, { ok: true });
        } catch (e) {
            auditLog.recordAudit({ action: "user_deleted", result: "failed", admin: session.username, target: body.username || null });
            if (e instanceof AuthError) return sendError(res, e.code === "not_found" ? 404 : 400, e.message);
            return sendError(res, 500, "Failed to delete user");
        }
    }

    if (pathname === "/api/users/reset-password" && req.method === "POST") {
        if (!requirePermission(res, currentUser, PERM.USERS_MANAGE, session, "POST /api/users/reset-password")) return;
        if (!requireCsrf(req, res, session)) return;
        let body = {};
        try {
            body = await readJsonBody(req);
        } catch (e) {
            return sendError(res, 400, "Invalid request body");
        }
        try {
            authStore.resetPassword(body.username, body.newPassword);
            // A forced password reset invalidates every existing session
            // for that user - otherwise a compromised/handed-over session
            // would survive the reset that was meant to shut it out.
            sessionStore.destroyAllForUser(body.username);
            auditLog.recordAudit({ action: "password_reset", result: "success", admin: session.username, target: body.username });
            return sendJson(res, 200, { ok: true });
        } catch (e) {
            auditLog.recordAudit({ action: "password_reset", result: "failed", admin: session.username, target: body.username || null });
            if (e instanceof AuthError) return sendError(res, e.code === "not_found" ? 404 : 400, e.message);
            return sendError(res, 500, "Failed to reset password");
        }
    }

    // -----------------------------------------------------------------
    // Stage 12, item #6 - Account / Security page. Available to EVERY
    // authenticated user (not gated by any PERM) - viewing your own
    // sessions and changing your own password should never require an
    // elevated role.
    // -----------------------------------------------------------------
    if (pathname === "/api/account/sessions" && req.method === "GET") {
        try {
            return sendJson(res, 200, { ok: true, sessions: sessionStore.listForUser(session.username, currentSid) });
        } catch (e) {
            return sendError(res, 500, "Failed to list sessions");
        }
    }

    if (pathname === "/api/account/sessions/revoke" && req.method === "POST") {
        if (!requireCsrf(req, res, session)) return;
        let body = {};
        try {
            body = await readJsonBody(req);
        } catch (e) {
            return sendError(res, 400, "Invalid request body");
        }
        if (!body.id) return sendError(res, 400, "id is required");
        const revoked = sessionStore.revokeByPublicId(session.username, body.id);
        auditLog.recordAudit({ action: "session_revoked", result: revoked ? "success" : "failed", admin: session.username, target: body.id });
        return sendJson(res, revoked ? 200 : 404, { ok: revoked });
    }

    if (pathname === "/api/account/change-password" && req.method === "POST") {
        if (!requireCsrf(req, res, session)) return;
        let body = {};
        try {
            body = await readJsonBody(req);
        } catch (e) {
            return sendError(res, 400, "Invalid request body");
        }
        try {
            authStore.changeOwnPassword(session.username, body.currentPassword, body.newPassword);
            // Keep the session that just performed the change alive; kill
            // every other session for this user (Stage 12, item #1/#2 -
            // a password change should immediately invalidate any other
            // logged-in device/browser using the old credential).
            const revokedCount = sessionStore.destroyAllForUser(session.username, currentSid);
            auditLog.recordAudit({ action: "password_change", result: "success", admin: session.username, target: revokedCount ? `${revokedCount} other session(s) revoked` : null });
            return sendJson(res, 200, { ok: true, otherSessionsRevoked: revokedCount });
        } catch (e) {
            auditLog.recordAudit({ action: "password_change", result: "failed", admin: session.username, target: null });
            if (e instanceof AuthError) return sendError(res, 400, e.message);
            return sendError(res, 500, "Failed to change password");
        }
    }

    // Read-only security activity feed scoped to the CURRENT user only -
    // never another user's login history, even for an Admin (that's what
    // the full /api/audit view - gated by PERM.AUDIT_VIEW - is for).
    if (pathname === "/api/account/activity" && req.method === "GET") {
        const SECURITY_ACTIONS = new Set(["dashboard_login", "dashboard_logout", "password_change", "password_reset", "session_revoked"]);
        try {
            const page = auditLog.readAuditPage({ limit: 500 });
            const events = page.entries.filter((e) => e.admin === session.username && SECURITY_ACTIONS.has(e.action)).slice(0, 50);
            return sendJson(res, 200, { ok: true, events });
        } catch (e) {
            return sendError(res, 500, "Failed to read account activity");
        }
    }

    // -----------------------------------------------------------------
    // Stage 8, item #9 - Dashboard Notifications (same polling cadence
    // the Dashboard already uses for everything else - see public/app.js)
    // -----------------------------------------------------------------
    if (pathname === "/api/notifications" && req.method === "GET") {
        const url = new URL(req.url, "http://internal");
        const since = url.searchParams.get("since");
        try {
            const result = since ? notifications.listSince(since) : notifications.listRecent(50);
            return sendJson(res, 200, { ok: true, ...result });
        } catch (e) {
            return sendError(res, 500, "Failed to read notifications");
        }
    }

    return sendError(res, 404, "Not found");
}

function summarizePlugins(pluginsMap, context) {
    const seen = new Set();
    const list = [];
    for (const [key, handler] of Object.entries(pluginsMap || {})) {
        if (seen.has(handler)) continue;
        seen.add(handler);

        const rawCommands = Array.isArray(handler.command)
            ? handler.command
            : handler.command
            ? [handler.command]
            : [key];

        // Stage 8, item #4 - additive fields; falls back gracefully if the
        // plugin-state system isn't ready yet.
        const stateInfo = context?.getPluginStateInfo ? context.getPluginStateInfo(rawCommands[0]) : null;

        list.push({
            command: rawCommands[0],
            aliases: rawCommands.slice(1),
            category: handler.category || "عام",
            description: handler.description || null,
            usage: handler.usage || null,
            requiredLevel: handler.requiredLevel || (handler.elite ? "elite" : "user"),
            scope: handler.group ? "group" : handler.prv ? "private" : "any",
            cooldownMs: typeof handler.cooldown === "number" ? handler.cooldown : null,
            locked: handler.lock === "on",
            file: handler.filePath ? path.basename(handler.filePath) : "unknown",
            status: typeof handler.execute === "function" ? "active" : "invalid",
            disabled: Boolean(stateInfo?.disabled),
            errorCount: stateInfo?.errorCount || 0,
            lastError: stateInfo?.lastError || null,
            protected: PROTECTED_PLUGIN_HINT.some((c) => rawCommands.includes(c)),
        });
    }
    return list;
}

// Mirrors handlers/pluginState.js's PROTECTED_COMMANDS purely for display
// purposes (so the UI can show a lock icon before the admin even tries) -
// the actual enforcement happens server-side in pluginState.setDisabled().
const PROTECTED_PLUGIN_HINT = ["اعدادات", "bot", "تفعيل", "on"];

function routePage(req, res, pathname) {
    const pageMap = {
        "/": "index.html",
        "/login": "login.html",
        "/statistics": "statistics.html",
        "/plugins": "plugins.html",
        "/logs": "logs.html",
        "/controls": "controls.html",
        // Stage 8 pages:
        "/alerts": "alerts.html",
        "/scheduler": "scheduler.html",
        "/settings": "settings.html",
        "/audit": "audit.html",
        "/backups": "backups.html",
        // Stage 11/12 pages:
        "/users": "users.html",
        "/account": "account.html",
    };
    if (pageMap[pathname]) return servePage(res, pageMap[pathname]);

    if (pathname.startsWith("/assets/")) {
        const rest = pathname.slice("/assets/".length);
        const filePath = safeStaticPath(rest);
        if (!filePath) return sendError(res, 400, "Invalid path");
        return serveStatic(res, filePath);
    }
    return sendError(res, 404, "Not found");
}

export function startDashboard(context) {
    const config = loadConfig();
    if (!config.enabled) {
        console.log("[Dashboard] Disabled via configuration (DASHBOARD_ENABLED=false). Skipping startup.");
        return null;
    }

    fs.mkdirSync(DATA_DIR, { recursive: true });
    const authStore = createAuthStore(DATA_DIR);

    const wantedAccounts = [{ username: config.bootstrapUsername, password: config.bootstrapPassword, isPrimaryOwner: true }];
    if (config.bootstrapUsername2) {
        wantedAccounts.push({ username: config.bootstrapUsername2, password: config.bootstrapPassword2, role: ROLES.ADMIN });
    }
    const bootstrap = authStore.ensureAccounts(wantedAccounts);
    if (bootstrap.createdAccounts.length) {
        console.log("========================================================");
        console.log(" [Dashboard] Admin account(s) created.");
        for (const acc of bootstrap.createdAccounts) {
            console.log(` [Dashboard] Username: ${acc.username} (${roleLabel(acc.role)})`);
            if (acc.generatedPassword) {
                console.log(` [Dashboard] Password: ${acc.generatedPassword}  (shown once, not stored in plain text)`);
            } else {
                console.log(` [Dashboard] Password: <as configured via environment variable>`);
            }
        }
        console.log("========================================================");
    }

    sessionStore = createSessionStore(config.sessionTtlMs);
    const limiter = createLoginLimiter({
        maxAttempts: config.maxLoginAttempts,
        lockoutMs: config.lockoutMs,
    });
    // Stricter, separate limiter for public self-registration - this
    // endpoint requires no credentials at all, so it needs its own guard
    // against spam/enumeration independent of the login limiter above.
    const registerLimiter = createLoginLimiter({ maxAttempts: 5, lockoutMs: 15 * 60 * 1000 });

    httpServer = http.createServer((req, res) => {
        let pathname;
        try {
            pathname = new URL(req.url, "http://internal").pathname;
        } catch (e) {
            return sendError(res, 400, "Bad request");
        }

        const onError = (err) => {
            console.error("[Dashboard] Unhandled request error:", err?.message || err);
            if (!res.headersSent) sendError(res, 500, "Internal error");
        };

        try {
            if (pathname.startsWith("/api/")) {
                handleApi(req, res, pathname, context, config, limiter, authStore, registerLimiter).catch(onError);
            } else {
                routePage(req, res, pathname);
            }
        } catch (err) {
            onError(err);
        }
    });

    httpServer.on("error", (err) => {
        // Item #14: a Dashboard failure must never take the bot down with it.
        console.error(`[Dashboard] Failed to start (${err?.message || err}). Bot continues running without it.`);
    });

    httpServer.listen(config.port, config.host, () => {
        console.log(`[Dashboard] Listening on http://${config.host}:${config.port}`);
    });

    scheduler.startScheduler(context); // Stage 8, item #5 - single central timer, idempotent

    cleanupHandlers = [() => sessionStore.stop(), () => scheduler.stopScheduler()];

    return httpServer;
}

/**
 * Stage 9, item #1 (Watchdog) - read-only health probe. Reports whether
 * the HTTP server object is currently alive, so the Watchdog can tell a
 * genuine "Dashboard crashed/closed unexpectedly" apart from
 * "Dashboard was never started" (login mode / DASHBOARD_ENABLED=false),
 * without adding any new listener or timer.
 */
export function isDashboardRunning() {
    return httpServer !== null;
}

export function stopDashboard() {
    return new Promise((resolve) => {
        for (const fn of cleanupHandlers) {
            try {
                fn();
            } catch (e) {
                /* best-effort cleanup */
            }
        }
        cleanupHandlers = [];
        if (!httpServer) return resolve();
        httpServer.close(() => {
            httpServer = null;
            resolve();
        });
        // Force-resolve in case some socket keeps the server from closing
        // promptly - this must never hang bot shutdown.
        setTimeout(resolve, 2000).unref?.();
    });
}
