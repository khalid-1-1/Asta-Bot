/**
 * dashboard/lib/recovery-log.js
 * -----------------------------------------------------------------------
 * Stage 9, item #12 (Recovery History).
 *
 * Deliberately mirrors dashboard/lib/audit-log.js's exact shape and
 * conventions (append-only JSONL, bounded windowed reads, never throws)
 * rather than inventing a new persistence pattern - this is Self-Healing
 * activity, not an administrative Dashboard action, so it is kept in its
 * own file/log rather than mixed into audit.log.
 *
 * Only ever receives what core/watchdog.js already builds: a subsystem
 * name, a short problem/detail string, an action label, an attempt
 * number, and a result. Nothing here ever receives (or could log) a raw
 * error object, a stack trace, or any credential - callers only pass
 * short text (item #12's "لكن لا تسجل Secrets").
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const RECOVERY_FILE = path.join(DATA_DIR, "recovery.log");

const WINDOW_BYTES = 256 * 1024;

function ensureDir() {
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    } catch (e) {
        /* best-effort */
    }
}

/** Records one self-healing event. Never throws. */
export function recordRecovery(entry = {}) {
    try {
        ensureDir();
        const record = {
            timestamp: entry.time || new Date().toISOString(),
            subsystem: String(entry.subsystem || "unknown"),
            problem: entry.problem ? String(entry.problem).slice(0, 300) : null,
            action: String(entry.action || "self_heal_attempt"),
            attempt: Number.isFinite(entry.attempt) ? entry.attempt : null,
            retryLimit: Number.isFinite(entry.retryLimit) ? entry.retryLimit : null,
            result: String(entry.result || "unknown"),
            resultDetail: entry.resultDetail ? String(entry.resultDetail).slice(0, 300) : null,
        };
        fs.appendFileSync(RECOVERY_FILE, JSON.stringify(record) + "\n", "utf8");
    } catch (e) {
        /* recovery logging must never break the self-healing it's logging */
    }
}

/**
 * Reads a bounded, newest-first window of recovery events - mirrors
 * audit-log.js's readAuditPage() paging convention exactly.
 */
export function readRecoveryPage({ beforeOffset, limit = 100 } = {}) {
    const cappedLimit = Math.max(1, Math.min(limit, 500));
    let stat;
    try {
        stat = fs.statSync(RECOVERY_FILE);
    } catch (e) {
        return { entries: [], nextOffset: null, done: true };
    }

    const endOffset = Math.min(beforeOffset ?? stat.size, stat.size);
    if (endOffset <= 0) return { entries: [], nextOffset: null, done: true };

    const startOffset = Math.max(0, endOffset - WINDOW_BYTES);
    const length = endOffset - startOffset;

    const fd = fs.openSync(RECOVERY_FILE, "r");
    let text;
    try {
        const buf = Buffer.alloc(length);
        fs.readSync(fd, buf, 0, length, startOffset);
        text = buf.toString("utf8");
    } finally {
        fs.closeSync(fd);
    }

    const lines = text.split("\n").filter(Boolean);
    if (startOffset > 0 && lines.length) lines.shift();

    const entries = [];
    for (const line of lines) {
        try {
            entries.push(JSON.parse(line));
        } catch (e) {
            /* skip unparsable line rather than fail the whole page */
        }
    }
    entries.reverse();

    const page = entries.slice(0, cappedLimit);
    const reachedFileStart = startOffset === 0;

    return {
        entries: page,
        nextOffset: reachedFileStart ? null : startOffset,
        done: reachedFileStart,
    };
}
