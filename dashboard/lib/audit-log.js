/**
 * dashboard/lib/audit-log.js
 * -----------------------------------------------------------------------
 * Stage 8, item #7 - Admin Audit Log.
 *
 * Separate from the Command Logs (asta/data/History.txt, Stage 6/7). This
 * file only records *administrative* Dashboard actions: login, failed
 * login, plugin reload/enable/disable, configuration changes, scheduler
 * CRUD, backup/restore.
 *
 * Format: one JSON object per line (JSONL) - append-only. There is
 * deliberately no update/delete function exported here, and server.js
 * never wires up any route that could edit or truncate this file, so the
 * Audit Log cannot be modified from the Dashboard itself (item #7's
 * explicit requirement).
 *
 * Passwords/tokens/session credentials are never passed into `details` -
 * every call site in server.js only ever passes plugin/command names,
 * setting keys, backup ids, etc.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const AUDIT_FILE = path.join(DATA_DIR, "audit.log");

const WINDOW_BYTES = 256 * 1024; // bounded read window, same convention as logs-reader.js

function ensureDir() {
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    } catch (e) {
        /* best-effort */
    }
}

/**
 * Records one administrative event. Never throws - a logging failure must
 * never break the action it is logging.
 */
export function recordAudit({ action, result = "success", admin = null, target = null } = {}) {
    try {
        ensureDir();
        const entry = {
            timestamp: new Date().toISOString(),
            action: String(action || "unknown"),
            result: String(result),
            admin: admin ? String(admin) : null,
            target: target ? String(target) : null,
        };
        fs.appendFileSync(AUDIT_FILE, JSON.stringify(entry) + "\n", "utf8");
    } catch (e) {
        /* audit logging must never break the caller */
    }
}

/**
 * Reads a bounded, newest-first window of audit events - never the whole
 * file (Stage 8, item #12). `beforeOffset` is a byte offset to page
 * backward from, mirroring dashboard/lib/logs-reader.js's convention.
 */
export function readAuditPage({ beforeOffset, limit = 100 } = {}) {
    const cappedLimit = Math.max(1, Math.min(limit, 500));
    let stat;
    try {
        stat = fs.statSync(AUDIT_FILE);
    } catch (e) {
        return { entries: [], nextOffset: null, done: true };
    }

    const endOffset = Math.min(beforeOffset ?? stat.size, stat.size);
    if (endOffset <= 0) return { entries: [], nextOffset: null, done: true };

    const startOffset = Math.max(0, endOffset - WINDOW_BYTES);
    const length = endOffset - startOffset;

    const fd = fs.openSync(AUDIT_FILE, "r");
    let text;
    try {
        const buf = Buffer.alloc(length);
        fs.readSync(fd, buf, 0, length, startOffset);
        text = buf.toString("utf8");
    } finally {
        fs.closeSync(fd);
    }

    const lines = text.split("\n").filter(Boolean);
    // The first line in our window may be a partial line if we didn't
    // start at a line boundary - drop it unless we're at the true start
    // of the file (offset 0).
    if (startOffset > 0 && lines.length) lines.shift();

    const entries = [];
    for (const line of lines) {
        try {
            entries.push(JSON.parse(line));
        } catch (e) {
            /* skip unparsable line rather than fail the whole page */
        }
    }
    entries.reverse(); // newest-first

    const page = entries.slice(0, cappedLimit);
    const reachedFileStart = startOffset === 0;

    return {
        entries: page,
        nextOffset: reachedFileStart ? null : startOffset,
        done: reachedFileStart,
    };
}
