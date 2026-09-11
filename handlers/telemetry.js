/**
 * handlers/telemetry.js
 * -----------------------------------------------------------------------
 * Stage 7 (Dashboard) needs *something* to read Statistics and categorized
 * Logs from. Before Stage 7 there was no dedicated Statistics/Logging
 * pipeline in this project - only asta/data/History.txt, a plain
 * append-only text log written by messages.js's logToHistory() for
 * connection/system/lock events.
 *
 * This module does NOT replace or duplicate that file. It:
 *   1. Appends its own entries to the SAME History.txt file, tagged with
 *      a category ([COMMAND]/[ERROR]/[SECURITY]/[GENERAL]) so the
 *      Dashboard's Logs page can filter a single, unified log.
 *   2. Maintains a small on-disk counter file (asta/data/stats.json) for
 *      Statistics (total commands, top commands, total errors, known
 *      users/chats) - updated incrementally as events happen, never
 *      recomputed from scratch on a Dashboard request.
 *
 * Every exported function is best-effort and never throws - a telemetry
 * failure must never be able to break a command or crash the bot.
 */

import fs from "fs-extra";
import path from "path";
import { pathToFileURL } from "url";
import { getPlugins } from "./plugins.js"; // Stage 8, item #2 - read-only, for "most used plugins"

const dataDir = path.join(process.cwd(), "asta", "data");
const historyPath = path.join(dataDir, "History.txt");
const statsPath = path.join(dataDir, "stats.json");

// Stage 8, item #2 (Advanced Statistics) & item #12 (Performance/Memory).
// Bounds so this can never grow without limit, no matter how long the
// process stays up:
const MAX_TRACKED_DISTINCT_COMMANDS = 500;
const DEFAULT_RETENTION_DAYS = 30;
const MIN_RETENTION_DAYS = 1;
const MAX_RETENTION_DAYS = 90;

// Optional, best-effort: read the admin-configurable retention setting
// (Stage 8, item #6 - Safe Configuration). This file must keep working
// with its own sane default even if the Dashboard's settings store is
// missing/not yet initialized - it never blocks on it and never throws.
let cachedGetRetentionDays = null;
async function getRetentionDays() {
    if (!cachedGetRetentionDays) {
        try {
            const mod = await import(pathToFileURL(pathToDashSettings()).href);
            cachedGetRetentionDays = () => {
                try {
                    const n = mod.getSettings().statsRetentionDays;
                    return Number.isFinite(n) ? n : DEFAULT_RETENTION_DAYS;
                } catch (e) {
                    return DEFAULT_RETENTION_DAYS;
                }
            };
        } catch (e) {
            cachedGetRetentionDays = () => DEFAULT_RETENTION_DAYS;
        }
    }
    try {
        const n = cachedGetRetentionDays();
        return Math.min(MAX_RETENTION_DAYS, Math.max(MIN_RETENTION_DAYS, n));
    } catch (e) {
        return DEFAULT_RETENTION_DAYS;
    }
}

function pathToDashSettings() {
    // handlers/ -> ../../.. -> bot/dashboard/lib/settings-store.js
    return path.join(process.cwd(), "..", "..", "dashboard", "lib", "settings-store.js");
}

// Same optional, best-effort pattern as the retention setting above -
// Stage 8, item #9 (Dashboard Notifications). A missing/broken
// notifications module must never affect error recording itself.
let cachedNotify = null;
async function getNotify() {
    if (!cachedNotify) {
        try {
            const modPath = path.join(process.cwd(), "..", "..", "dashboard", "lib", "notifications.js");
            cachedNotify = await import(pathToFileURL(modPath).href);
        } catch (e) {
            cachedNotify = null;
        }
    }
    return cachedNotify;
}

function todayKey(d = new Date()) {
    return d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC, stable/sortable)
}

let lastError = null; // Stage 8, item #1 - surfaced via Health Monitoring
export function getLastError() {
    return lastError;
}

// Stage 8, item #3 (Alerts) - a short, bounded window of error timestamps
// so an "error rate spike" can be evaluated without rescanning any log.
// Pruned on every push; hard-capped defensively even if the clock is off.
const errorTimestamps = [];
function pushErrorTimestamp() {
    const now = Date.now();
    errorTimestamps.push(now);
    const cutoff = now - 24 * 60 * 60 * 1000;
    while (errorTimestamps.length && (errorTimestamps[0] < cutoff || errorTimestamps.length > 500)) {
        errorTimestamps.shift();
    }
}
export function getErrorTimestamps() {
    return [...errorTimestamps];
}

// Refreshed periodically in the background so recordCommand()/recordError()
// (hot path, called on every single command) never has to `await` anything -
// they just read this cached number. Never a new per-command timer.
let cachedRetentionValue = DEFAULT_RETENTION_DAYS;
async function refreshRetentionCache() {
    try {
        cachedRetentionValue = await getRetentionDays();
    } catch (e) {
        /* keep previous cached value */
    }
}
refreshRetentionCache();
const retentionRefreshTimer = setInterval(refreshRetentionCache, 5 * 60 * 1000);
if (retentionRefreshTimer.unref) retentionRefreshTimer.unref();

function ensureDataDir() {
    try {
        fs.ensureDirSync(dataDir);
    } catch (e) {
        /* best-effort */
    }
}

function appendHistory(category, text) {
    try {
        ensureDataDir();
        const timestamp = new Date().toLocaleString("en-US", { hour12: false });
        const entry = `\n[${timestamp}] [${category}]\n${text}\n`;
        fs.appendFileSync(historyPath, entry, "utf8");
    } catch (e) {
        /* logging must never break the bot */
    }
}

let stats = null;

function defaultStats() {
    return {
        totalCommands: 0,
        totalErrors: 0,
        commandUsage: {},
        knownUsers: [],
        knownChats: [],
        startedAt: Date.now(),
        // Stage 8, item #2 (Advanced Statistics) - additive fields below.
        // daily: { "YYYY-MM-DD": { commands: n, errors: n, messages: n, byCommand: {}, byHour: [24 ints], messagesByHour: [24 ints] } }
        daily: {},
        errorsByCommand: {},
        errorsByPlugin: {},
        // Stage 10 (Dashboard Redesign) - total inbound messages seen by the
        // bot (before the command-prefix check), so the Dashboard's
        // "Messages" card/chart can show a real number instead of reusing
        // the command count. Purely additive counter, same debounced/atomic
        // persistence as everything else in this file.
        totalMessages: 0,
    };
}

function loadStats() {
    if (stats) return stats;
    ensureDataDir();
    try {
        if (fs.existsSync(statsPath)) {
            const parsed = JSON.parse(fs.readFileSync(statsPath, "utf8"));
            if (parsed && typeof parsed === "object") stats = parsed;
        }
    } catch (e) {
        /* fall through to defaults */
    }
    if (!stats) stats = defaultStats();
    stats.commandUsage ||= {};
    stats.knownUsers ||= [];
    stats.knownChats ||= [];
    stats.daily ||= {};
    stats.errorsByCommand ||= {};
    stats.errorsByPlugin ||= {};
    if (typeof stats.totalCommands !== "number") stats.totalCommands = 0;
    if (typeof stats.totalErrors !== "number") stats.totalErrors = 0;
    if (typeof stats.totalMessages !== "number") stats.totalMessages = 0;
    return stats;
}

function dayBucket(s, key) {
    if (!s.daily[key]) {
        s.daily[key] = { commands: 0, errors: 0, messages: 0, byCommand: {}, byHour: new Array(24).fill(0), messagesByHour: new Array(24).fill(0) };
    }
    // Older buckets (written before Stage 10) may be missing the new
    // messages fields - backfill them in place so old data keeps working.
    if (typeof s.daily[key].messages !== "number") s.daily[key].messages = 0;
    if (!Array.isArray(s.daily[key].messagesByHour)) s.daily[key].messagesByHour = new Array(24).fill(0);
    return s.daily[key];
}

/**
 * Drops daily buckets older than the configured retention window (Stage 8,
 * item #2 - "ضع Retention مناسبًا للبيانات التاريخية"). Cheap: at most one
 * pass over the (small, day-granularity) key set, run opportunistically
 * from recordCommand/recordError rather than on its own timer.
 */
function pruneOldDays(s) {
    const keys = Object.keys(s.daily);
    if (keys.length <= cachedRetentionValue) return;
    const cutoff = todayKey(new Date(Date.now() - cachedRetentionValue * 86400000));
    for (const key of keys) {
        if (key < cutoff) delete s.daily[key];
    }
}

function boundedIncrement(map, key, cap = MAX_TRACKED_DISTINCT_COMMANDS) {
    if (map[key] === undefined && Object.keys(map).length >= cap) return; // bounded - see item #12
    map[key] = (map[key] || 0) + 1;
}

let saveTimer = null;

// Stage 9, item #9 (Data Integrity): this used to write stats.json
// directly (fs.writeFileSync straight to the real path). If the process
// was killed mid-write, that file could be left truncated/corrupt - the
// exact "Corrupted JSON / Partial writes" case item #9 calls out. Every
// other persisted file in this project (handlers/stats.js,
// dashboard/lib/backup.js, dashboard/lib/scheduler.js) already writes
// via temp-file-then-rename; this brings stats.json in line with that
// same convention. The data written and the debounce behavior are
// unchanged - only how it's written to disk changed.
function writeStatsAtomic() {
    try {
        ensureDataDir();
        const tmpFile = `${statsPath}.tmp-${process.pid}`;
        fs.writeFileSync(tmpFile, JSON.stringify(stats, null, 2));
        fs.renameSync(tmpFile, statsPath);
    } catch (e) {
        /* best-effort - matches this module's existing "never throws" contract */
    }
}

function persistStatsDebounced() {
    // Debounced so a burst of commands doesn't hammer disk I/O (Stage 7,
    // item #13 - Dashboard/telemetry must not affect bot performance).
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        writeStatsAtomic();
    }, 2000);
    if (saveTimer.unref) saveTimer.unref();
}

/**
 * Stage 9, item #4 (Graceful Shutdown) / item #9 (Data Integrity).
 * Flushes any pending debounced write immediately and synchronously so
 * the last few seconds of statistics are never lost to the 2s debounce
 * window on SIGINT/SIGTERM/restart. Safe to call at any time - a no-op
 * write if nothing changed since the last flush.
 */
export function flushStatsNow() {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
    writeStatsAtomic();
}

// -----------------------------------------------------------------------
// Stage 10 (Dashboard Redesign & Visualization) - Message activity.
// Called once per inbound message the bot actually processes (see
// handlers/messages.js#handleSingleMessage), regardless of whether it
// turns out to be a recognized command. This is the only addition to the
// bot's own message-handling logic made for this stage (item #14 - only
// what's "ضروريًا جدًا لتوفير بيانات للواجهة"), and it's a single
// best-effort counter increment: it can never throw, block, or change
// what happens to the message afterward.
// -----------------------------------------------------------------------
export function recordMessage() {
    try {
        const s = loadStats();
        s.totalMessages += 1;

        const now = new Date();
        const bucket = dayBucket(s, todayKey(now));
        bucket.messages += 1;
        bucket.messagesByHour[now.getUTCHours()] += 1;
        pruneOldDays(s);

        persistStatsDebounced();
    } catch (e) {
        /* never break message handling */
    }
}

export function recordCommand(command, sender, chatId) {
    try {
        const s = loadStats();
        s.totalCommands += 1;
        s.commandUsage[command] = (s.commandUsage[command] || 0) + 1;

        const userId = sender?.pn || sender?.lid || null;
        if (userId && !s.knownUsers.includes(userId)) s.knownUsers.push(userId);
        if (chatId && !s.knownChats.includes(chatId)) s.knownChats.push(chatId);

        // Stage 8, item #2: daily/hourly buckets for trends + retention.
        const now = new Date();
        const bucket = dayBucket(s, todayKey(now));
        bucket.commands += 1;
        boundedIncrement(bucket.byCommand, command);
        bucket.byHour[now.getUTCHours()] += 1;
        pruneOldDays(s);

        persistStatsDebounced();
        appendHistory("COMMAND", `CMD: ${command}\nUSER: ${userId || "unknown"}\nCHAT: ${chatId || "unknown"}`);
    } catch (e) {
        /* never break command execution */
    }
}

export function recordError(command, err, pluginFile) {
    try {
        const s = loadStats();
        s.totalErrors += 1;
        boundedIncrement(s.errorsByCommand, command || "unknown");
        boundedIncrement(s.errorsByPlugin, pluginFile || "unknown");

        const bucket = dayBucket(s, todayKey());
        bucket.errors += 1;
        pruneOldDays(s);

        lastError = { message: err?.message || String(err), at: new Date().toISOString(), source: `command:${command || "unknown"}`, pluginFile: pluginFile || null };
        pushErrorTimestamp();

        // Stage 8, item #9 - fire-and-forget, never blocks/throws into the
        // command's own error handling.
        getNotify()
            .then((mod) => mod?.notifyPluginFailure?.(`فشل تنفيذ الأمر "${command || "unknown"}" في ${pluginFile || "unknown"}: ${err?.message || String(err)}`))
            .catch(() => {});

        persistStatsDebounced();
        appendHistory(
            "ERROR",
            `CMD: ${command || "unknown"}\nPLUGIN: ${pluginFile || "unknown"}\nMSG: ${err?.message || String(err)}`
        );
    } catch (e) {
        /* never break error handling */
    }
}

export function recordSecurity(text) {
    appendHistory("SECURITY", text);
}

export function recordGeneral(text) {
    appendHistory("GENERAL", text);
}

export function getStats() {
    const s = loadStats();
    const topCommands = Object.entries(s.commandUsage)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([command, count]) => ({ command, count }));

    return {
        totalCommands: s.totalCommands,
        totalErrors: s.totalErrors,
        totalMessages: s.totalMessages,
        topCommands,
        commandUsage: s.commandUsage,
        knownUsers: s.knownUsers.length,
        knownChats: s.knownChats.length,
    };
}

export function getHistoryPath() {
    return historyPath;
}

/**
 * Stage 8, item #2 (Advanced Statistics) - everything here is derived from
 * the counters above; nothing here re-reads/re-parses History.txt or any
 * other log, so a Dashboard request is always cheap regardless of how long
 * the bot has been running.
 */
export function getAdvancedStats() {
    const s = loadStats();
    const now = new Date();
    const todayK = todayKey(now);
    const weekKeys = [];
    for (let i = 0; i < 7; i++) {
        weekKeys.push(todayKey(new Date(now.getTime() - i * 86400000)));
    }

    const todayBucket = s.daily[todayK] || { commands: 0, errors: 0, messages: 0, byCommand: {}, byHour: new Array(24).fill(0), messagesByHour: new Array(24).fill(0) };
    const weeklyCommands = weekKeys.reduce((sum, k) => sum + (s.daily[k]?.commands || 0), 0);
    const weeklyErrors = weekKeys.reduce((sum, k) => sum + (s.daily[k]?.errors || 0), 0);
    const weeklyMessages = weekKeys.reduce((sum, k) => sum + (s.daily[k]?.messages || 0), 0);

    // Usage trend: every retained day, oldest first (chart-friendly).
    const dailyUsage = Object.keys(s.daily)
        .sort()
        .map((date) => ({
            date,
            commands: s.daily[date].commands,
            errors: s.daily[date].errors,
            messages: s.daily[date].messages || 0,
        }));

    const errorsByCommand = Object.entries(s.errorsByCommand)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([command, count]) => ({ command, count }));

    const errorsByPlugin = Object.entries(s.errorsByPlugin)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([plugin, count]) => ({ plugin, count }));

    // Most used plugins: aggregate commandUsage by the plugin file that
    // owns each command (a file can register several commands/aliases).
    let mostUsedPlugins = [];
    try {
        const plugins = getPlugins();
        const perPlugin = new Map(); // filePath -> count
        for (const [command, count] of Object.entries(s.commandUsage)) {
            const handler = plugins[command];
            const file = handler?.pluginId || handler?.filePath || null;
            if (!file) continue;
            perPlugin.set(file, (perPlugin.get(file) || 0) + count);
        }
        mostUsedPlugins = [...perPlugin.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([plugin, count]) => ({ plugin, count }));
    } catch (e) {
        mostUsedPlugins = [];
    }

    return {
        today: { commands: todayBucket.commands, errors: todayBucket.errors, messages: todayBucket.messages || 0 },
        weekly: { commands: weeklyCommands, errors: weeklyErrors, messages: weeklyMessages },
        usageByHour: todayBucket.byHour,
        messagesByHour: todayBucket.messagesByHour || new Array(24).fill(0),
        dailyUsage, // full retained trend series
        mostUsedPlugins,
        errorsByCommand,
        errorsByPlugin,
        retentionDays: cachedRetentionValue,
    };
}
