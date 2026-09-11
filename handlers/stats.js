/**
 * handlers/stats.js
 * -----------------------------------------------------------------------
 * Stage 6 — Command Statistics.
 *
 * Tracks lightweight usage counters (NOT message content, NOT full
 * history) so "حالة" / "احصائيات" can report something real instead of
 * invented numbers:
 *
 *   - total commands executed
 *   - per-command execution count + last-used time (-> "top commands")
 *   - total errors
 *   - a bounded count of distinct users / chats seen
 *
 * Persistence is a single small JSON file, written atomically (temp file
 * + rename, item #10 of the request) and only every FLUSH_INTERVAL_MS
 * (not on every single command), so this can never become a Bottleneck.
 * A read/write failure here must never crash the bot - every public
 * function is wrapped so it degrades to "counters just live in memory
 * for this run" instead of throwing.
 */

import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "asta", "data");
const STATS_FILE = path.join(DATA_DIR, "stats.json");
const FLUSH_INTERVAL_MS = 30000;

// Bounds so long-running processes can't grow these structures forever
// (item #4/#10 of the request: no unbounded memory, no giant file).
const MAX_TRACKED_COMMANDS = 500; // distinct command names
const MAX_TRACKED_USERS = 3000;
const MAX_TRACKED_CHATS = 1000;

const state = {
  totalCommands: 0,
  totalErrors: 0,
  commandCounts: Object.create(null), // command -> count
  lastUsed: Object.create(null),      // command -> ISO timestamp
  users: new Set(),
  chats: new Set(),
  startedAt: Date.now(),
};

let dirty = false;
let loadPromise = null;

async function loadFromDisk() {
  try {
    if (await fs.pathExists(STATS_FILE)) {
      const raw = await fs.readJson(STATS_FILE);
      state.totalCommands = Number(raw.totalCommands) || 0;
      state.totalErrors = Number(raw.totalErrors) || 0;
      state.commandCounts = raw.commandCounts && typeof raw.commandCounts === "object"
        ? { ...raw.commandCounts }
        : Object.create(null);
      state.lastUsed = raw.lastUsed && typeof raw.lastUsed === "object"
        ? { ...raw.lastUsed }
        : Object.create(null);
      state.users = new Set(Array.isArray(raw.users) ? raw.users : []);
      state.chats = new Set(Array.isArray(raw.chats) ? raw.chats : []);
    }
  } catch (e) {
    // Corrupt/missing stats file: start fresh rather than crash.
  }
}

function ensureLoaded() {
  if (!loadPromise) loadPromise = loadFromDisk();
  return loadPromise;
}
ensureLoaded();

export function recordCommand(command, senderId, chatId) {
  try {
    if (!command) return;
    state.totalCommands++;

    if (
      state.commandCounts[command] === undefined &&
      Object.keys(state.commandCounts).length >= MAX_TRACKED_COMMANDS
    ) {
      // Extremely unlikely in a real bot (finite plugin set), but keeps
      // this bounded even if something spams bogus command names.
      return;
    }
    state.commandCounts[command] = (state.commandCounts[command] || 0) + 1;
    state.lastUsed[command] = new Date().toISOString();

    if (senderId && state.users.size < MAX_TRACKED_USERS) state.users.add(senderId);
    if (chatId && state.chats.size < MAX_TRACKED_CHATS) state.chats.add(chatId);

    dirty = true;
  } catch (e) {
    // Stats are a nice-to-have; never let this break command execution.
  }
}

export function recordError(command) {
  try {
    state.totalErrors++;
    dirty = true;
  } catch (e) {}
}

export function getSummary() {
  try {
    const topCommands = Object.entries(state.commandCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([command, count]) => ({ command, count, lastUsed: state.lastUsed[command] || null }));

    return {
      totalCommands: state.totalCommands,
      totalErrors: state.totalErrors,
      distinctCommands: Object.keys(state.commandCounts).length,
      topCommands,
      knownUsers: state.users.size,
      knownChats: state.chats.size,
      uptimeSeconds: Math.floor(process.uptime()),
      startedAt: state.startedAt,
    };
  } catch (e) {
    return {
      totalCommands: 0,
      totalErrors: 0,
      distinctCommands: 0,
      topCommands: [],
      knownUsers: 0,
      knownChats: 0,
      uptimeSeconds: Math.floor(process.uptime()),
      startedAt: state.startedAt,
    };
  }
}

async function flush() {
  if (!dirty) return;
  dirty = false;
  try {
    await fs.ensureDir(DATA_DIR);
    const payload = {
      totalCommands: state.totalCommands,
      totalErrors: state.totalErrors,
      commandCounts: state.commandCounts,
      lastUsed: state.lastUsed,
      users: Array.from(state.users),
      chats: Array.from(state.chats),
    };
    // Atomic write: write to a temp file first, then rename over the real
    // file, so a crash/kill mid-write can never leave stats.json corrupt.
    const tmpFile = `${STATS_FILE}.tmp-${process.pid}`;
    await fs.writeJson(tmpFile, payload);
    await fs.rename(tmpFile, STATS_FILE);
  } catch (e) {
    dirty = true; // retry on next tick
  }
}

const flushTimer = setInterval(() => {
  flush();
}, FLUSH_INTERVAL_MS);
if (typeof flushTimer.unref === "function") flushTimer.unref();

const statsModule = { recordCommand, recordError, getSummary, flush };
export default statsModule;
