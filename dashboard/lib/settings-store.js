/**
 * dashboard/lib/settings-store.js
 * -----------------------------------------------------------------------
 * Stage 8, item #6 - Safe Configuration.
 *
 * Everything in SCHEMA below is deliberately non-sensitive: alert
 * thresholds, statistics retention, scheduler tick interval, dashboard
 * poll hint. NONE of the following ever live here, and this module has
 * no code path that could ever read/write them:
 *   passwords, encryption keys, API tokens, session credentials,
 *   WhatsApp auth/session files, or any other secret.
 * (Those are owned by dashboard/lib/auth-store.js, dashboard/lib/
 * sessions.js, and main.js's own encryption - none of which this file
 * imports or touches.)
 *
 * Every value has a type, a safe range, and a default; an out-of-range or
 * wrong-typed update is rejected (with a reason) rather than silently
 * clamped or applied - the caller (server.js) reports that back to the
 * Dashboard so a typo can never brick a running setting.
 *
 * Persistence: dashboard/data/settings.json, atomic write (temp + rename),
 * same convention as auth-store.js/pluginState.js. A missing/corrupt file
 * degrades to "all defaults" - never throws.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

export const SCHEMA = Object.freeze({
    statsRetentionDays: { type: "number", min: 1, max: 90, default: 30, label: "Statistics retention (days)" },

    alertErrorCount: { type: "number", min: 1, max: 1000, default: 10, label: "Error spike: count" },
    alertErrorWindowMinutes: { type: "number", min: 1, max: 1440, default: 10, label: "Error spike: window (minutes)" },

    alertReconnectCount: { type: "number", min: 1, max: 100, default: 5, label: "Reconnect storm: count" },
    alertReconnectWindowMinutes: { type: "number", min: 1, max: 1440, default: 15, label: "Reconnect storm: window (minutes)" },

    alertPluginFailureCount: { type: "number", min: 1, max: 1000, default: 5, label: "Plugin failing repeatedly: count" },

    alertMemoryMB: { type: "number", min: 64, max: 16384, default: 1024, label: "High memory usage (MB)" },

    alertDashboardErrorCount: { type: "number", min: 1, max: 1000, default: 10, label: "Dashboard/API errors: count" },
    alertDashboardErrorWindowMinutes: { type: "number", min: 1, max: 1440, default: 10, label: "Dashboard/API errors: window (minutes)" },

    alertCooldownMinutes: { type: "number", min: 1, max: 1440, default: 30, label: "Alert cooldown / dedup (minutes)" },

    schedulerTickSeconds: { type: "number", min: 10, max: 3600, default: 30, label: "Scheduler check interval (seconds)" },
});

function defaults() {
    const out = {};
    for (const [key, def] of Object.entries(SCHEMA)) out[key] = def.default;
    return out;
}

function ensureDir() {
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    } catch (e) {
        /* best-effort */
    }
}

let cache = null;

function load() {
    if (cache) return cache;
    ensureDir();
    let onDisk = {};
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
            if (raw && typeof raw === "object") onDisk = raw;
        }
    } catch (e) {
        /* corrupt file -> fall back to defaults, never throw */
    }

    const merged = defaults();
    for (const key of Object.keys(SCHEMA)) {
        const v = validateOne(key, onDisk[key]);
        if (v.ok) merged[key] = v.value;
    }
    cache = merged;
    return cache;
}

function persist() {
    try {
        ensureDir();
        const tmp = `${SETTINGS_FILE}.tmp-${process.pid}`;
        fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), { mode: 0o600 });
        fs.renameSync(tmp, SETTINGS_FILE);
        try { fs.chmodSync(SETTINGS_FILE, 0o600); } catch (e) {}
    } catch (e) {
        /* best-effort - in-memory cache is still correct for this run */
    }
}

function validateOne(key, value) {
    const def = SCHEMA[key];
    if (!def) return { ok: false, reason: "unknown_setting" };
    if (value === undefined || value === null) return { ok: false, reason: "missing" };

    if (def.type === "number") {
        const n = Number(value);
        if (!Number.isFinite(n)) return { ok: false, reason: "must_be_a_number" };
        if (n < def.min || n > def.max) return { ok: false, reason: `must_be_between_${def.min}_and_${def.max}` };
        return { ok: true, value: n };
    }
    return { ok: false, reason: "unsupported_type" };
}

/** Current, fully-validated settings (schema defaults filled in). */
export function getSettings() {
    return { ...load() };
}

export function getSchema() {
    return SCHEMA;
}

/**
 * Validates and applies a partial update. Unknown keys and invalid values
 * are rejected individually (not fatal to the rest of the batch) so one
 * typo can't block every other change in the same request.
 * Returns { applied: {key: value}, errors: {key: reason} }.
 */
export function updateSettings(patch) {
    const s = load();
    const applied = {};
    const errors = {};
    if (!patch || typeof patch !== "object") return { applied, errors: { _: "invalid_payload" } };

    for (const [key, value] of Object.entries(patch)) {
        const result = validateOne(key, value);
        if (result.ok) {
            s[key] = result.value;
            applied[key] = result.value;
        } else {
            errors[key] = result.reason;
        }
    }
    if (Object.keys(applied).length) persist();
    return { applied, errors };
}

/** Used only by Backup & Recovery restore (Stage 8, item #8). */
export function replaceAll(values) {
    const next = defaults();
    if (values && typeof values === "object") {
        for (const key of Object.keys(SCHEMA)) {
            const v = validateOne(key, values[key]);
            if (v.ok) next[key] = v.value;
        }
    }
    cache = next;
    persist();
    return getSettings();
}
