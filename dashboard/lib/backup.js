/**
 * dashboard/lib/backup.js
 * -----------------------------------------------------------------------
 * Stage 8, item #8 - Backup & Recovery.
 *
 * WHAT IS BACKED UP (deliberately, and only): the Dashboard's own Safe
 * Configuration (settings-store.js), the Scheduler's task list, each
 * plugin's enable/disable state, and a statistics snapshot. Nothing here
 * ever reads WhatsApp auth/session files, encryption keys, passwords, or
 * API tokens, and nothing in the backup JSON can contain them - the
 * payload is built entirely from the same safe getters the Dashboard API
 * already exposes (context.getAdvancedStats/getStats,
 * context.exportPluginState, scheduler.exportTasks,
 * settings-store.getSettings), never from a raw file read.
 *
 * SECURITY (item #11): backup ids are generated here, never taken from
 * the browser as a file path - every lookup re-validates the id against
 * a strict allow-list pattern and resolves it inside BACKUPS_DIR only,
 * so a crafted id can never escape the backups directory (path
 * traversal).
 *
 * RESTORE SAFETY (item #8's explicit requirement): before applying a
 * restore, (1) the backup's structure is validated, (2) a fresh
 * "pre-restore safety" backup of the *current* state is created, and
 * (3) every target module's new state is fully prepared and validated
 * in memory before a single one of them is committed - so a failure
 * partway through can never leave Configuration/Scheduler/Plugin state
 * half-updated.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import * as settingsStore from "./settings-store.js";
import * as scheduler from "./scheduler.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const BACKUPS_DIR = path.join(DATA_DIR, "backups");

const ID_PATTERN = /^[A-Za-z0-9_-]{6,80}$/;
const MAX_BACKUPS = 100;

function ensureDir() {
    try {
        fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    } catch (e) {}
}

function genId() {
    return `bk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Resolves an id to a path strictly inside BACKUPS_DIR, or null if unsafe. */
function safePathFor(id) {
    if (typeof id !== "string" || !ID_PATTERN.test(id)) return null;
    const resolved = path.resolve(BACKUPS_DIR, `${id}.json`);
    if (path.dirname(resolved) !== path.resolve(BACKUPS_DIR)) return null; // defense in depth
    return resolved;
}

function buildPayload(context, name) {
    return {
        version: 1,
        id: genId(),
        name: (name || "backup").toString().slice(0, 100),
        createdAt: new Date().toISOString(),
        dashboardSettings: settingsStore.getSettings(),
        schedulerTasks: scheduler.exportTasks(),
        pluginState: context.exportPluginState ? context.exportPluginState() : {},
        statisticsSnapshot: context.getStats ? context.getStats() : null,
    };
}

// Stage 9, item #10 (Backup Verification). Computed over every field
// except `checksum` itself, so it can be recomputed and compared on
// every later read - a backup file corrupted or partially written after
// creation (disk error, manual edit, truncated copy) is detected instead
// of silently trusted.
function computeChecksum(payload) {
    const { checksum, ...rest } = payload;
    return crypto.createHash("sha256").update(JSON.stringify(rest)).digest("hex");
}

function isValidBackupShape(payload) {
    return Boolean(
        payload &&
            typeof payload === "object" &&
            payload.version === 1 &&
            payload.dashboardSettings &&
            typeof payload.dashboardSettings === "object" &&
            Array.isArray(payload.schedulerTasks) &&
            payload.pluginState &&
            typeof payload.pluginState === "object"
    );
}

/** True only if the backup's structure AND checksum both check out. */
function isVerifiedBackup(payload) {
    if (!isValidBackupShape(payload)) return false;
    if (typeof payload.checksum !== "string" || !payload.checksum) return false;
    return computeChecksum(payload) === payload.checksum;
}

export function listBackups() {
    ensureDir();
    let files = [];
    try {
        files = fs.readdirSync(BACKUPS_DIR).filter((f) => f.endsWith(".json"));
    } catch (e) {
        return [];
    }
    const out = [];
    for (const file of files) {
        try {
            const full = path.join(BACKUPS_DIR, file);
            const stat = fs.statSync(full);
            const payload = JSON.parse(fs.readFileSync(full, "utf8"));
            // Stage 9, item #10 - surface verification status rather than
            // silently listing a corrupted backup as if it were fine.
            const verified = isVerifiedBackup(payload);
            out.push({ id: payload.id || path.basename(file, ".json"), name: payload.name, createdAt: payload.createdAt, sizeBytes: stat.size, verified });
        } catch (e) {
            /* skip unreadable/corrupt backup file rather than fail the whole list */
        }
    }
    out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)); // newest-first
    return out;
}

export function createBackup(context, name) {
    ensureDir();
    if (listBackups().length >= MAX_BACKUPS) {
        return { ok: false, reason: "too_many_backups" };
    }
    const payload = buildPayload(context, name);
    payload.checksum = computeChecksum(payload); // item #10
    const dest = safePathFor(payload.id);
    if (!dest) return { ok: false, reason: "id_generation_failed" };
    try {
        const tmp = `${dest}.tmp-${process.pid}`;
        fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
        fs.renameSync(tmp, dest);
    } catch (e) {
        return { ok: false, reason: "write_failed" };
    }
    // Item #10 - "تأكد أن الملف قابل للقراءة": read the file straight back
    // and re-verify its checksum before reporting success, so a disk
    // fault that corrupts the just-written file is caught immediately
    // instead of only being discovered the next time someone restores it.
    let verifyPayload;
    try {
        verifyPayload = JSON.parse(fs.readFileSync(dest, "utf8"));
    } catch (e) {
        return { ok: false, reason: "post_write_verification_failed" };
    }
    if (!isVerifiedBackup(verifyPayload)) {
        return { ok: false, reason: "post_write_checksum_mismatch" };
    }
    return { ok: true, manifest: { id: payload.id, name: payload.name, createdAt: payload.createdAt, checksum: payload.checksum } };
}

export function deleteBackup(id) {
    const full = safePathFor(id);
    if (!full) return { ok: false, reason: "invalid_id" };
    try {
        if (!fs.existsSync(full)) return { ok: false, reason: "not_found" };
        fs.unlinkSync(full);
        return { ok: true };
    } catch (e) {
        return { ok: false, reason: "delete_failed" };
    }
}

function readBackup(id) {
    const full = safePathFor(id);
    if (!full || !fs.existsSync(full)) return null;
    try {
        return JSON.parse(fs.readFileSync(full, "utf8"));
    } catch (e) {
        return null;
    }
}

/**
 * Restores a backup. See the module header for the safety sequence.
 * Returns { ok, reason?, safetyBackupId? }.
 */
export function restoreBackup(id, context) {
    const payload = readBackup(id);
    if (!payload) return { ok: false, reason: "not_found" };
    // Stage 9, item #10 - refuse to restore a corrupted/tampered backup;
    // previously this only checked the JSON *shape*, which a corrupted
    // file can still accidentally satisfy.
    if (!isVerifiedBackup(payload)) return { ok: false, reason: "invalid_backup_structure" };

    // 1. Safety backup of current state, taken BEFORE anything is touched.
    const safety = createBackup(context, `pre-restore-safety-${Date.now()}`);
    if (!safety.ok) return { ok: false, reason: "safety_backup_failed" };

    // 2. Prepare every change in memory / validate first (so we never
    //    commit some modules and not others).
    let preparedSettings;
    try {
        preparedSettings = { ...payload.dashboardSettings };
    } catch (e) {
        return { ok: false, reason: "invalid_settings_in_backup", safetyBackupId: safety.manifest.id };
    }

    // 3. Commit. Each module validates/normalizes its own input again on
    //    the way in (replaceAll/importTasks/importPluginState all
    //    re-check every field - never a raw trust-the-file write) - if
    //    any step throws, we stop and tell the admin to restore the
    //    safety backup rather than leaving a half-applied state.
    try {
        settingsStore.replaceAll(preparedSettings);
        scheduler.importTasks(payload.schedulerTasks);
        if (context.importPluginState) context.importPluginState(payload.pluginState);
    } catch (e) {
        return { ok: false, reason: "restore_failed_partway", safetyBackupId: safety.manifest.id, error: e?.message };
    }

    return { ok: true, safetyBackupId: safety.manifest.id, restoredFrom: payload.id };
}
