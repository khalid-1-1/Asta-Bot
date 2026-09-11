/**
 * dashboard/lib/logs-reader.js
 * -----------------------------------------------------------------------
 * Reads Stage 6's existing plain-text log (asta/data/History.txt,
 * written by handlers/messages.js's logToHistory + Stage 7's
 * handlers/telemetry.js) in bounded windows, newest-first, with a byte
 * offset cursor for "load more" - the file is never read into memory or
 * sent to the browser in one piece.
 *
 * Entry format on disk (both writers use this shape):
 *   \n[<timestamp>] [<CATEGORY>]\n<body...>\n
 * Older entries written before Stage 7 omit "[<CATEGORY>]"; those are
 * classified heuristically from their body text (see classify()).
 */

import fs from "fs";

const WINDOW_BYTES = 512 * 1024; // read at most 512KB per page from disk
const CATEGORIES = ["GENERAL", "COMMAND", "ERROR", "SECURITY"];

function classify(headerLine, body) {
    const explicit = headerLine.match(/\]\s*\[(\w+)\]\s*$/);
    if (explicit && CATEGORIES.includes(explicit[1].toUpperCase())) {
        return explicit[1].toUpperCase();
    }
    const text = `${headerLine}\n${body}`;
    if (/\[SECURITY|\[LOCK\]|SECURITY ALERT|BANNED|WRONG PASS/i.test(text)) return "SECURITY";
    if (/error|failed|Plugin Error/i.test(text)) return "ERROR";
    if (/^CMD:|\[COOLDOWN\]/im.test(text)) return "COMMAND";
    return "GENERAL";
}

function parseEntries(chunkText) {
    // Every entry starts with a line like "[2026-09-06 10:00:00]" possibly
    // followed by "[CATEGORY]". Split right before those.
    const rawEntries = chunkText.split(/\n(?=\[\d{1,2}\/\d{1,2}\/\d{4}|\[\d{4}-\d{2}-\d{2}|\[[A-Za-z]{3}\s)/);
    const entries = [];
    for (const raw of rawEntries) {
        const trimmed = raw.trim();
        if (!trimmed) continue;
        const lines = trimmed.split("\n");
        const headerLine = lines[0];
        const timestampMatch = headerLine.match(/^\[(.*?)\]/);
        const timestamp = timestampMatch ? timestampMatch[1] : null;
        const body = lines.slice(1).join("\n").trim();
        entries.push({
            timestamp,
            category: classify(headerLine, body),
            text: body || headerLine,
        });
    }
    return entries;
}

/**
 * Reads one bounded, newest-first window of log entries.
 *
 * @param {string} historyPath
 * @param {object} opts
 * @param {number} [opts.beforeOffset] byte offset to read backward from
 *   (defaults to end of file). Returned as `nextOffset` for the next page.
 * @param {string} [opts.category] one of CATEGORIES, or falsy for all.
 * @param {string} [opts.search] case-insensitive substring filter.
 * @param {number} [opts.limit] max number of entries to return.
 */
export function readLogPage(historyPath, opts = {}) {
    const limit = Math.max(1, Math.min(opts.limit || 100, 500));

    let stat;
    try {
        stat = fs.statSync(historyPath);
    } catch (e) {
        return { entries: [], nextOffset: null, done: true, totalSizeBytes: 0 };
    }

    const endOffset = Math.min(opts.beforeOffset ?? stat.size, stat.size);
    if (endOffset <= 0) return { entries: [], nextOffset: null, done: true, totalSizeBytes: stat.size };

    const startOffset = Math.max(0, endOffset - WINDOW_BYTES);
    const length = endOffset - startOffset;

    const fd = fs.openSync(historyPath, "r");
    let text;
    try {
        const buf = Buffer.alloc(length);
        fs.readSync(fd, buf, 0, length, startOffset);
        text = buf.toString("utf8");
    } finally {
        fs.closeSync(fd);
    }

    let entries = parseEntries(text).reverse(); // newest-first within window

    if (opts.category && CATEGORIES.includes(opts.category)) {
        entries = entries.filter((e) => e.category === opts.category);
    }
    if (opts.search) {
        const needle = opts.search.toLowerCase();
        entries = entries.filter((e) => e.text.toLowerCase().includes(needle));
    }
    if (opts.dateFrom || opts.dateTo) {
        entries = entries.filter((e) => {
            const t = e.timestamp ? Date.parse(e.timestamp) : NaN;
            if (Number.isNaN(t)) return true; // don't drop unparseable legacy timestamps
            if (opts.dateFrom && t < opts.dateFrom) return false;
            if (opts.dateTo && t > opts.dateTo) return false;
            return true;
        });
    }

    const page = entries.slice(0, limit);
    const reachedFileStart = startOffset === 0;

    return {
        entries: page,
        nextOffset: reachedFileStart ? null : startOffset,
        done: reachedFileStart,
        totalSizeBytes: stat.size,
    };
}

export const LOG_CATEGORIES = CATEGORIES;
