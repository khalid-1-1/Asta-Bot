/**
 * dashboard/lib/notifications.js
 * -----------------------------------------------------------------------
 * Stage 8, item #9 - Dashboard Notifications.
 *
 * A small, bounded, in-memory queue (never persisted, never grows without
 * limit - Stage 8 item #12: "لا تحفظ Notifications إلى الأبد"). The
 * Dashboard polls GET /api/notifications?since=<id> at the same interval
 * it already polls everything else (config.pollIntervalMs, ~5s) - this
 * module creates no timer of its own, and nothing here changes how often
 * the browser talks to the server.
 */

const MAX_NOTIFICATIONS = 200;

let nextId = 1;
const queue = []; // { id, type, level, text, createdAt }

function push(type, level, text) {
    const entry = { id: nextId++, type, level, text, createdAt: new Date().toISOString() };
    queue.push(entry);
    if (queue.length > MAX_NOTIFICATIONS) queue.shift();
    return entry;
}

export function notifyError(text) {
    return push("error", "error", text);
}
export function notifyAlert(text) {
    return push("alert", "warning", text);
}
export function notifyReconnect(text) {
    return push("reconnect", "info", text);
}
export function notifyPluginFailure(text) {
    return push("plugin_failure", "warning", text);
}
export function notifyAdminAction(text) {
    return push("admin_action", "info", text);
}
export function notifyBackupResult(text, ok = true) {
    return push("backup", ok ? "info" : "error", text);
}

/** Notifications with id > since, oldest-first, plus the latest id known. */
export function listSince(since = 0) {
    const sinceNum = Number(since) || 0;
    const items = queue.filter((n) => n.id > sinceNum);
    return { items, latestId: queue.length ? queue[queue.length - 1].id : sinceNum };
}

export function listRecent(limit = 50) {
    const capped = Math.max(1, Math.min(limit, MAX_NOTIFICATIONS));
    const items = queue.slice(-capped).reverse();
    return { items, latestId: queue.length ? queue[queue.length - 1].id : 0 };
}
