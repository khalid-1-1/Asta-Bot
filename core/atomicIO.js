/**
 * core/atomicIO.js
 * -----------------------------------------------------------------------
 * Stage 9, item #9 (Data Integrity).
 *
 * A single, shared "temp file -> rename" helper so every Stage 9 module
 * (Watchdog / Recovery History / Memory Protection notes) writes its own
 * state files the same safe way the project already writes
 * dashboard/lib/backup.js, dashboard/lib/scheduler.js and
 * handlers/stats.js: never a direct write to the real path, always a
 * temp file first, then an atomic rename over it. A crash or kill
 * mid-write can therefore never leave one of these files half-written
 * or corrupt - the reader either sees the old complete file or the new
 * complete file, never a partial one.
 *
 * This module has zero dependencies beyond Node's own `fs`/`path`, so it
 * can be imported from anywhere in the project (bot process, Dashboard)
 * without adding a new package.
 */

import fs from 'fs';
import path from 'path';

function tmpPathFor(filePath) {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath);
    return path.join(dir, `.${base}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

/** Synchronous atomic write of raw text/Buffer data. */
export function atomicWriteFileSync(filePath, data) {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = tmpPathFor(filePath);
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, filePath);
}

/** Synchronous atomic write of a JSON-serializable value. */
export function atomicWriteJsonSync(filePath, value, pretty = true) {
    atomicWriteFileSync(filePath, JSON.stringify(value, null, pretty ? 2 : 0));
}

/** Async atomic write of raw text/Buffer data. */
export async function atomicWriteFile(filePath, data) {
    const dir = path.dirname(filePath);
    await fs.promises.mkdir(dir, { recursive: true });
    const tmp = tmpPathFor(filePath);
    await fs.promises.writeFile(tmp, data);
    await fs.promises.rename(tmp, filePath);
}

/** Async atomic write of a JSON-serializable value. */
export async function atomicWriteJson(filePath, value, pretty = true) {
    await atomicWriteFile(filePath, JSON.stringify(value, null, pretty ? 2 : 0));
}

/**
 * Reads and parses a JSON file, never throwing. Returns `fallback` if the
 * file is missing, empty, or contains corrupted/partial JSON - this is
 * the "read side" companion to the atomic writers above: even if some
 * *other*, non-atomic writer ever leaves a corrupt file on disk, callers
 * using this helper degrade to `fallback` instead of crashing.
 */
export function readJsonSafeSync(filePath, fallback = null) {
    try {
        if (!fs.existsSync(filePath)) return fallback;
        const raw = fs.readFileSync(filePath, 'utf8');
        if (!raw || !raw.trim()) return fallback;
        return JSON.parse(raw);
    } catch (e) {
        return fallback;
    }
}

/**
 * Appends one line to a file, never throwing (mirrors the convention
 * already used by dashboard/lib/audit-log.js). Not "atomic" in the
 * temp+rename sense - appendFileSync is used for logs where partial-line
 * writes on abrupt kill are an acceptable, self-healing risk (bounded
 * readers already skip unparsable lines) - but a failure here can never
 * throw into the caller.
 */
export function appendLineSafeSync(filePath, line) {
    try {
        const dir = path.dirname(filePath);
        fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(filePath, line.endsWith('\n') ? line : line + '\n', 'utf8');
    } catch (e) {
        /* best-effort, matches audit-log.js's "logging must never break the caller" rule */
    }
}
