/**
 * handlers/logger.js
 * -----------------------------------------------------------------------
 * Stage 6 — Central Logging System.
 *
 * A small, dependency-light logger used ONLY to record short, useful
 * lines about what the bot is doing (commands, errors, security events,
 * general/system events). It does NOT touch Permissions, the Plugin
 * Loader, Encryption/SECRET_KEY, or any command/game logic — it is purely
 * an additive helper that other modules call into.
 *
 * Design goals (see Stage 6 request):
 *   - 4 log "channels": general / commands / errors / security
 *   - Each line: timestamp, level, command/event, sender/chat (if any),
 *     short message.
 *   - Never log full message bodies, passwords, password attempts,
 *     encryption keys, API keys, tokens, session credentials, or any
 *     other unnecessary sensitive content. See sanitizeMeta()/redactText().
 *   - Split logs by type AND by day, so no single file grows forever:
 *       logs/general/<YYYY-MM-DD>.log
 *       logs/commands/<YYYY-MM-DD>.log
 *       logs/errors/<YYYY-MM-DD>.log
 *       logs/security/<YYYY-MM-DD>.log
 *   - No fs.writeFileSync per message: every call just pushes a line into
 *     an in-memory queue; a single interval flushes each queue to disk
 *     with async fs I/O every FLUSH_INTERVAL_MS.
 *   - A logger failure (bad disk, permissions, whatever) must NEVER throw
 *     out of these exported functions and must NEVER stop the bot from
 *     processing messages - worst case it just fails silently to console.
 *
 * This file has no dependency on messages.js/plugins.js/permissions.js,
 * so it can be safely imported from any of them without creating a
 * circular import.
 */

import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGS_ROOT = path.join(__dirname, "..", "logs");

const TYPES = ["general", "commands", "errors", "security"];
const FLUSH_INTERVAL_MS = 2000;

const queues = {
  general: [],
  commands: [],
  errors: [],
  security: [],
};

// Hard ceiling per queue so a disk outage can't turn this into an
// ever-growing in-memory array (item #8 of the request: no unbounded
// buffers). If we ever hit this, we drop the oldest lines - losing a
// few old log lines is much better than an OOM crash.
const MAX_QUEUE_LENGTH = 2000;

function pad(n) {
  return String(n).padStart(2, "0");
}

function dayStamp(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function timeStamp(d) {
  return `${dayStamp(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// Field NAMES that must never be written, regardless of their value.
// Matches "password", "passwordAttempt", "token", "apiKey", "api_key",
// "secret", "secretKey", "session", "credentials", etc.
const SENSITIVE_KEY_PATTERN = /pass(word)?|token|secret|api[_-]?key|creds?|credential|session/i;

// Best-effort scrub for free-text messages. This is a SAFETY NET on top of
// the real defense, which is: call sites never pass raw passwords/tokens/
// keys into the logger in the first place (see e.g. the masked "*****"
// input already used for lock-listener logging in messages.js). Two shapes
// are covered here:
//   1) "key=value" / "key: value" pairs where key looks sensitive (covers
//      short secrets too, e.g. an 8-char password, not just long ones).
//   2) long base64/hex-ish runs, the shape encryption keys/tokens/API keys
//      usually take even without a "key=" prefix.
const SENSITIVE_INLINE_PATTERN = /\b(pass(?:word)?|token|secret|api[_-]?key|creds?|credentials?|session)\b(\s*[:=]\s*)(\S+)/gi;

function redactText(text) {
  if (typeof text !== "string") return text;
  let out = text.replace(SENSITIVE_INLINE_PATTERN, (_match, key, sep) => `${key}${sep}[REDACTED]`);
  out = out.replace(/[A-Za-z0-9+/_-]{24,}={0,2}/g, "[REDACTED]");
  return out;
}

function sanitizeMeta(meta) {
  const clean = {};
  if (!meta || typeof meta !== "object") return clean;
  for (const [key, value] of Object.entries(meta)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) continue; // dropped entirely, not masked
    clean[key] = typeof value === "string" ? redactText(value) : value;
  }
  return clean;
}

function formatLine(level, message, meta) {
  const clean = sanitizeMeta(meta);
  const now = new Date();
  const parts = [`[${timeStamp(now)}]`, `[${level}]`];
  if (clean.command) parts.push(`CMD=${clean.command}`);
  if (clean.event) parts.push(`EVENT=${clean.event}`);
  if (clean.chat) parts.push(`CHAT=${clean.chat}`);
  if (clean.sender) parts.push(`SENDER=${clean.sender}`);
  const msg = redactText(String(message ?? "")).slice(0, 500); // keep lines short/useful
  parts.push(msg);
  return parts.join(" ");
}

function enqueue(type, level, message, meta) {
  try {
    const queue = queues[type];
    if (!queue) return;
    queue.push(formatLine(level, message, meta));
    if (queue.length > MAX_QUEUE_LENGTH) {
      queue.splice(0, queue.length - MAX_QUEUE_LENGTH);
    }
  } catch (e) {
    // A formatting bug must never break the caller.
  }
}

let flushing = false;

async function flushType(type) {
  const queue = queues[type];
  if (!queue || queue.length === 0) return;
  const lines = queue.splice(0, queue.length);
  try {
    const dir = path.join(LOGS_ROOT, type);
    await fs.ensureDir(dir);
    const file = path.join(dir, `${dayStamp(new Date())}.log`);
    await fs.appendFile(file, lines.join("\n") + "\n", "utf8");
  } catch (e) {
    // Item #9 of the request: a logger failure must not crash/stop the bot.
    try {
      console.error(`[logger] failed to write "${type}" log:`, e?.message || e);
    } catch (_) {
      /* even console can theoretically throw in exotic environments */
    }
  }
}

export async function flushLogs() {
  if (flushing) return;
  flushing = true;
  try {
    for (const type of TYPES) {
      await flushType(type);
    }
  } finally {
    flushing = false;
  }
}

const flushTimer = setInterval(() => {
  flushLogs();
}, FLUSH_INTERVAL_MS);
// Don't keep the process alive just for this timer.
if (typeof flushTimer.unref === "function") flushTimer.unref();

/** General/system events: startup, plugin (re)load, reconnects, misc info. */
export function logGeneral(message, meta) {
  enqueue("general", "GENERAL", message, meta);
}

/** One line per executed command (no full message text, ever). */
export function logCommand(message, meta) {
  enqueue("commands", "COMMAND", message, meta);
}

/** Command errors, plugin load errors, and other unexpected failures. */
export function logError(message, meta) {
  enqueue("errors", "ERROR", message, meta);
}

/** Password-lock attempts/results, hardware-fingerprint/session alerts, etc. */
export function logSecurity(message, meta) {
  enqueue("security", "SECURITY", message, meta);
}

const centralLogger = { logGeneral, logCommand, logError, logSecurity, flushLogs };
export default centralLogger;
