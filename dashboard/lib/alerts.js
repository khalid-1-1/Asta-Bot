/**
 * dashboard/lib/alerts.js
 * -----------------------------------------------------------------------
 * Stage 8, item #3 - Alerts System.
 *
 * Deliberately pull-based: evaluate() is only ever called when the
 * Dashboard requests /api/alerts (or another module asks for the current
 * alert list) - there is no timer of its own here, so this can never add
 * background CPU/interval usage on top of Stage 1-7.
 *
 * Cooldown/deduplication (item #3's explicit requirement: "لا ترسل Alert
 * عند كل Error") is a small in-memory Map keyed by "type:key" ->
 * lastFiredAt. An alert condition that is still true after its cooldown
 * expires is reported again as a *new* firing (and pushed to
 * notifications.js once); while still within cooldown, the same
 * condition keeps showing up in the *active* list returned by evaluate()
 * (so the Dashboard always reflects current reality) without re-spamming
 * a new notification each poll.
 */

import { getSettings } from "./settings-store.js";
import * as notifications from "./notifications.js";

const lastFired = new Map(); // "type:key" -> timestamp (ms)
const activeAlerts = new Map(); // "type:key" -> { type, key, level, message, firstSeenAt, lastSeenAt }

function withinCooldown(id, cooldownMs) {
    const last = lastFired.get(id);
    return typeof last === "number" && Date.now() - last < cooldownMs;
}

function fire(id, { type, key, level, message }) {
    const now = new Date().toISOString();
    const wasCold = !lastFired.has(id) || !withinCooldown(id, currentCooldownMs);

    const existing = activeAlerts.get(id);
    activeAlerts.set(id, {
        type,
        key,
        level,
        message,
        firstSeenAt: existing?.firstSeenAt || now,
        lastSeenAt: now,
    });

    if (wasCold) {
        lastFired.set(id, Date.now());
        notifications.notifyAlert(message);
    }
}

let currentCooldownMs = 30 * 60 * 1000;

function countWithin(timestamps, windowMs) {
    const cutoff = Date.now() - windowMs;
    return timestamps.filter((t) => t >= cutoff).length;
}

/**
 * Evaluates every alert rule against fresh inputs and the current
 * (admin-editable) thresholds. Returns the list of currently-active
 * alerts (still within their cooldown window, so they don't disappear
 * from the UI the instant the condition is no longer freshly-firing).
 *
 * `inputs`:
 *   reconnectTimestamps: number[] (ms epoch)
 *   errorTimestamps: number[] (ms epoch)
 *   memoryUsageBytes: number
 *   pluginErrors: [{ pluginId, errorCount, disabled }]
 *   dashboardErrorTimestamps: number[] (ms epoch)
 */
export function evaluate(inputs = {}) {
    const settings = getSettings();
    currentCooldownMs = settings.alertCooldownMinutes * 60 * 1000;

    // 1. Abnormal error rate.
    const errorWindowMs = settings.alertErrorWindowMinutes * 60 * 1000;
    const recentErrors = countWithin(inputs.errorTimestamps || [], errorWindowMs);
    if (recentErrors >= settings.alertErrorCount) {
        fire("error_spike:global", {
            type: "error_spike",
            key: "global",
            level: "critical",
            message: `ارتفاع غير طبيعي في الأخطاء: ${recentErrors} خطأ خلال آخر ${settings.alertErrorWindowMinutes} دقيقة (الحد: ${settings.alertErrorCount}).`,
        });
    }

    // 2. Plugin failing repeatedly.
    for (const p of inputs.pluginErrors || []) {
        if (p.errorCount >= settings.alertPluginFailureCount) {
            fire(`plugin_failure:${p.pluginId}`, {
                type: "plugin_failure",
                key: p.pluginId,
                level: "warning",
                message: `البلوجن "${p.pluginId}" فشل ${p.errorCount} مرة (الحد: ${settings.alertPluginFailureCount}).`,
            });
        }
    }

    // 3. Frequent reconnects in a short period.
    const reconnectWindowMs = settings.alertReconnectWindowMinutes * 60 * 1000;
    const recentReconnects = countWithin(inputs.reconnectTimestamps || [], reconnectWindowMs);
    if (recentReconnects >= settings.alertReconnectCount) {
        fire("reconnect_storm:global", {
            type: "reconnect_storm",
            key: "global",
            level: "critical",
            message: `إعادة اتصال متكررة: ${recentReconnects} مرة خلال آخر ${settings.alertReconnectWindowMinutes} دقيقة (الحد: ${settings.alertReconnectCount}).`,
        });
    }

    // 4. High memory usage.
    const memMB = (inputs.memoryUsageBytes || 0) / (1024 * 1024);
    if (memMB >= settings.alertMemoryMB) {
        fire("high_memory:global", {
            type: "high_memory",
            key: "global",
            level: "warning",
            message: `استهلاك ذاكرة مرتفع: ${memMB.toFixed(0)}MB (الحد: ${settings.alertMemoryMB}MB).`,
        });
    }

    // 5. Repeated Dashboard/API errors.
    const dashWindowMs = settings.alertDashboardErrorWindowMinutes * 60 * 1000;
    const recentDashErrors = countWithin(inputs.dashboardErrorTimestamps || [], dashWindowMs);
    if (recentDashErrors >= settings.alertDashboardErrorCount) {
        fire("dashboard_errors:global", {
            type: "dashboard_errors",
            key: "global",
            level: "warning",
            message: `أخطاء متكررة في الداشبورد/API: ${recentDashErrors} خلال آخر ${settings.alertDashboardErrorWindowMinutes} دقيقة (الحد: ${settings.alertDashboardErrorCount}).`,
        });
    }

    // Drop alerts from the "active" view once they've been quiet for a
    // full cooldown period (bounded memory - Stage 8, item #12).
    const now = Date.now();
    for (const [id, alert] of activeAlerts) {
        if (now - new Date(alert.lastSeenAt).getTime() > currentCooldownMs) {
            activeAlerts.delete(id);
        }
    }

    return [...activeAlerts.entries()].map(([id, alert]) => ({ id, ...alert }));
}
