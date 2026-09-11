/**
 * handlers/pluginState.js
 * -----------------------------------------------------------------------
 * Stage 8, item #4 (Advanced Plugin Management).
 *
 * This module owns exactly one thing: whether a plugin is logically
 * "enabled" or "disabled", plus small operational metadata about it
 * (last reload time, last error, error count). It does NOT load plugins,
 * does NOT touch plugin source files, and does NOT replace
 * handlers/plugins.js's loader/hot-reload system - it is read by
 * plugins.js (to tag a loaded handler as disabled) and by messages.js
 * (to refuse dispatch for a disabled command), and written to by the
 * Dashboard (enable/disable) and by plugins.js/messages.js (error
 * tracking) via the small API below.
 *
 * Persistence: a single small JSON file (asta/data/pluginState.json),
 * written atomically (temp file + rename) so a crash mid-write can never
 * corrupt it. A read/parse failure degrades to "nothing disabled, no
 * history" instead of throwing - this must never be able to break plugin
 * loading or command dispatch.
 *
 * Plugin identity: plugins are keyed by their path *relative to the
 * plugins/ directory* (e.g. "جروب/admin.js"), not by command name -
 * a single file can register multiple commands/aliases (item #4 of
 * Stage 3), and this keeps one enable/disable flag per *file*, matching
 * "لا تحذف Plugin من الملفات / لا تعدّل Plugin source code" (this is a
 * purely logical flag, never a filesystem operation).
 */

import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "asta", "data");
const STATE_FILE = path.join(DATA_DIR, "pluginState.json");

// Commands that must never be disabled from the Dashboard - disabling any
// of these could brick the bot's own recovery path (turning it back on,
// reaching settings) with no way back short of editing files on disk.
// Mirrors the exact bypass list already hardcoded in messages.js's
// `botState === "off"` check, so this list is descriptive, not a new rule.
export const PROTECTED_COMMANDS = Object.freeze(["اعدادات", "bot", "تفعيل", "on"]);

const MAX_TRACKED_PLUGINS = 1000; // generous bound; a real install has a few hundred files at most

let state = null; // { plugins: { [pluginId]: { disabled, lastError, errorCount, disabledAt, disabledBy } } }
let lastReloadIso = null;

function defaultState() {
    return { plugins: Object.create(null) };
}

function ensureDir() {
    try {
        fs.ensureDirSync(DATA_DIR);
    } catch (e) {
        /* best-effort */
    }
}

function load() {
    if (state) return state;
    ensureDir();
    try {
        if (fs.existsSync(STATE_FILE)) {
            const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
            if (raw && typeof raw === "object" && raw.plugins && typeof raw.plugins === "object") {
                state = { plugins: raw.plugins };
            }
        }
    } catch (e) {
        /* corrupt/missing file -> start fresh, never throw */
    }
    if (!state) state = defaultState();
    return state;
}

let saveTimer = null;
function persist() {
    // Debounced disk write (Stage 8, item #12 - no I/O storm on bursts of
    // plugin errors); each toggle also still updates the in-memory state
    // immediately so reads are always fresh.
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        try {
            ensureDir();
            const tmp = `${STATE_FILE}.tmp-${process.pid}`;
            fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
            fs.renameSync(tmp, STATE_FILE);
        } catch (e) {
            /* best-effort - next mutation will retry via the debounce */
        }
    }, 500);
    if (saveTimer.unref) saveTimer.unref();
}

function entryFor(pluginId) {
    const s = load();
    if (!s.plugins[pluginId]) {
        if (Object.keys(s.plugins).length >= MAX_TRACKED_PLUGINS) {
            // Bound reached (should never happen in practice) - reuse a
            // throwaway object rather than growing forever.
            return { disabled: false, lastError: null, errorCount: 0 };
        }
        s.plugins[pluginId] = { disabled: false, lastError: null, errorCount: 0, disabledAt: null, disabledBy: null };
    }
    return s.plugins[pluginId];
}

/** Path relative to the plugins/ directory - the canonical plugin id. */
export function toPluginId(filePath, pluginsDir) {
    if (!filePath) return null;
    try {
        return path.relative(pluginsDir, filePath).split(path.sep).join("/");
    } catch (e) {
        return path.basename(filePath);
    }
}

export function isDisabled(pluginId) {
    if (!pluginId) return false;
    const s = load();
    return Boolean(s.plugins[pluginId]?.disabled);
}

/**
 * Enable/disable a plugin. `commands` is the list of command names the
 * plugin's file registers - used only to enforce PROTECTED_COMMANDS.
 * Returns { ok, reason }.
 */
export function setDisabled(pluginId, disabled, { commands = [], admin = null } = {}) {
    if (!pluginId) return { ok: false, reason: "unknown_plugin" };

    if (disabled) {
        const hitsProtected = commands.some((c) => PROTECTED_COMMANDS.includes(String(c).toLowerCase()));
        if (hitsProtected) {
            return { ok: false, reason: "protected_plugin" };
        }
    }

    const entry = entryFor(pluginId);
    entry.disabled = Boolean(disabled);
    entry.disabledAt = disabled ? new Date().toISOString() : null;
    entry.disabledBy = disabled ? admin || null : null;
    persist();
    return { ok: true };
}

export function recordLoadError(pluginId, message) {
    if (!pluginId) return;
    const entry = entryFor(pluginId);
    entry.lastError = { message: String(message || "unknown error"), at: new Date().toISOString(), phase: "load" };
    entry.errorCount = (entry.errorCount || 0) + 1;
    persist();
}

export function recordRuntimeError(pluginId, message) {
    if (!pluginId) return;
    const entry = entryFor(pluginId);
    entry.lastError = { message: String(message || "unknown error"), at: new Date().toISOString(), phase: "runtime" };
    entry.errorCount = (entry.errorCount || 0) + 1;
    persist();
}

export function getEntry(pluginId) {
    if (!pluginId) return null;
    const s = load();
    return s.plugins[pluginId] || null;
}

export function markReloaded() {
    lastReloadIso = new Date().toISOString();
}

export function getLastReload() {
    return lastReloadIso;
}

/** Full export (id -> entry) - used by Backup & Recovery (Stage 8, item #8). */
export function exportAll() {
    const s = load();
    return JSON.parse(JSON.stringify(s.plugins));
}

/**
 * Restore from a backup snapshot. Only ever writes the shape this module
 * itself produces - never trusts arbitrary keys blindly (each entry is
 * re-normalized), so a corrupted/foreign backup can't inject garbage.
 */
export function importAll(pluginsMap) {
    const next = Object.create(null);
    if (pluginsMap && typeof pluginsMap === "object") {
        for (const [id, entry] of Object.entries(pluginsMap)) {
            if (!entry || typeof entry !== "object") continue;
            next[id] = {
                disabled: Boolean(entry.disabled),
                lastError: entry.lastError && typeof entry.lastError === "object" ? entry.lastError : null,
                errorCount: Number.isFinite(entry.errorCount) ? entry.errorCount : 0,
                disabledAt: typeof entry.disabledAt === "string" ? entry.disabledAt : null,
                disabledBy: typeof entry.disabledBy === "string" ? entry.disabledBy : null,
            };
        }
    }
    state = { plugins: next };
    persist();
}

export default {
    PROTECTED_COMMANDS,
    toPluginId,
    isDisabled,
    setDisabled,
    recordLoadError,
    recordRuntimeError,
    getEntry,
    markReloaded,
    getLastReload,
    exportAll,
    importAll,
};
