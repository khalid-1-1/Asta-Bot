/**
 * dashboard/lib/scheduler.js
 * -----------------------------------------------------------------------
 * Stage 8, item #5 - Scheduled Tasks.
 *
 * SECURITY (item #11 / item #5's explicit requirement): the Dashboard can
 * never make the server run arbitrary Shell or JavaScript. A task's
 * `action.type` must be a key of ALLOWED_ACTIONS below - there is no code
 * path anywhere in this file that eval()s, spawns a shell, or otherwise
 * executes text the browser sent. Adding a new capability means adding a
 * new named function to ALLOWED_ACTIONS in *code*, not something the
 * Dashboard can ever do from the browser.
 *
 * PERFORMANCE (item #12): exactly one setInterval for every task in the
 * system - not one timer per task. Persistence is to a single JSON file,
 * written atomically (temp + rename), the same convention used
 * throughout Stage 7/8.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getSettings } from "./settings-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const TASKS_FILE = path.join(DATA_DIR, "scheduler.json");

const MAX_TASKS = 200;
const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_NAMES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/**
 * The one and only place task actions are defined. Each function receives
 * the dashboard `context` (the same object server.js already uses) and
 * must return a short human-readable result string.
 */
const ALLOWED_ACTIONS = {
    reloadPlugins: async (context) => {
        await context.reloadAllPlugins();
        return "تم إعادة تحميل جميع البلوجنز";
    },
};

export function getAllowedActionTypes() {
    return Object.keys(ALLOWED_ACTIONS);
}

let tasks = null; // array
let timer = null;
let running = false; // re-entrancy guard for the tick itself

function ensureDir() {
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    } catch (e) {}
}

function load() {
    if (tasks) return tasks;
    ensureDir();
    try {
        if (fs.existsSync(TASKS_FILE)) {
            const raw = JSON.parse(fs.readFileSync(TASKS_FILE, "utf8"));
            if (Array.isArray(raw)) tasks = raw;
        }
    } catch (e) {
        /* corrupt file -> start empty, never throw */
    }
    if (!tasks) tasks = [];
    return tasks;
}

function persist() {
    try {
        ensureDir();
        const tmp = `${TASKS_FILE}.tmp-${process.pid}`;
        fs.writeFileSync(tmp, JSON.stringify(tasks, null, 2));
        fs.renameSync(tmp, TASKS_FILE);
    } catch (e) {
        /* best-effort */
    }
}

function genId() {
    return `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function validateSchedule(schedule) {
    if (!schedule || typeof schedule !== "object") return { ok: false, reason: "missing_schedule" };
    if (schedule.type === "once") {
        const t = Date.parse(schedule.at);
        if (Number.isNaN(t)) return { ok: false, reason: "invalid_once_at" };
        return { ok: true };
    }
    if (schedule.type === "daily") {
        if (!/^\d{2}:\d{2}$/.test(schedule.time || "")) return { ok: false, reason: "invalid_time" };
        return { ok: true };
    }
    if (schedule.type === "weekly") {
        if (!/^\d{2}:\d{2}$/.test(schedule.time || "")) return { ok: false, reason: "invalid_time" };
        if (!DAY_NAMES.includes(schedule.dayOfWeek)) return { ok: false, reason: "invalid_day_of_week" };
        return { ok: true };
    }
    return { ok: false, reason: "invalid_schedule_type" };
}

function computeNextRun(schedule, from = new Date()) {
    if (schedule.type === "once") {
        const t = Date.parse(schedule.at);
        return t > from.getTime() ? new Date(t).toISOString() : null; // past one-time task never (re)fires
    }
    if (schedule.type === "daily") {
        const [h, m] = schedule.time.split(":").map(Number);
        const next = new Date(from);
        next.setSeconds(0, 0);
        next.setHours(h, m, 0, 0);
        if (next.getTime() <= from.getTime()) next.setTime(next.getTime() + DAY_MS);
        return next.toISOString();
    }
    if (schedule.type === "weekly") {
        const [h, m] = schedule.time.split(":").map(Number);
        const targetDay = DAY_NAMES.indexOf(schedule.dayOfWeek);
        const next = new Date(from);
        next.setSeconds(0, 0);
        next.setHours(h, m, 0, 0);
        let diff = (targetDay - next.getDay() + 7) % 7;
        if (diff === 0 && next.getTime() <= from.getTime()) diff = 7;
        next.setTime(next.getTime() + diff * DAY_MS);
        return next.toISOString();
    }
    return null;
}

export function listTasks() {
    return load().map((t) => ({ ...t }));
}

export function getTask(id) {
    return load().find((t) => t.id === id) || null;
}

export function createTask({ name, schedule, action, enabled = true }) {
    const list = load();
    if (list.length >= MAX_TASKS) return { ok: false, reason: "too_many_tasks" };
    if (!name || typeof name !== "string" || !name.trim()) return { ok: false, reason: "missing_name" };
    if (!action || !ALLOWED_ACTIONS[action.type]) return { ok: false, reason: "action_not_allowed" };

    const scheduleCheck = validateSchedule(schedule);
    if (!scheduleCheck.ok) return { ok: false, reason: scheduleCheck.reason };

    const task = {
        id: genId(),
        name: name.trim().slice(0, 100),
        schedule,
        action: { type: action.type }, // whitelisted type only - nothing else is ever stored
        enabled: Boolean(enabled),
        createdAt: new Date().toISOString(),
        lastRun: null,
        nextRun: enabled ? computeNextRun(schedule) : null,
        lastResult: null,
    };
    list.push(task);
    persist();
    return { ok: true, task };
}

export function updateTask(id, patch = {}) {
    const list = load();
    const task = list.find((t) => t.id === id);
    if (!task) return { ok: false, reason: "not_found" };

    if (patch.name !== undefined) {
        if (!patch.name.trim()) return { ok: false, reason: "missing_name" };
        task.name = patch.name.trim().slice(0, 100);
    }
    if (patch.schedule !== undefined) {
        const check = validateSchedule(patch.schedule);
        if (!check.ok) return { ok: false, reason: check.reason };
        task.schedule = patch.schedule;
    }
    if (patch.action !== undefined) {
        if (!ALLOWED_ACTIONS[patch.action.type]) return { ok: false, reason: "action_not_allowed" };
        task.action = { type: patch.action.type };
    }
    if (patch.enabled !== undefined) task.enabled = Boolean(patch.enabled);

    task.nextRun = task.enabled ? computeNextRun(task.schedule) : null;
    persist();
    return { ok: true, task };
}

export function deleteTask(id) {
    const list = load();
    const idx = list.findIndex((t) => t.id === id);
    if (idx === -1) return { ok: false, reason: "not_found" };
    list.splice(idx, 1);
    persist();
    return { ok: true };
}

async function runTaskNow(task, context) {
    task.lastRun = new Date().toISOString();
    try {
        const resultText = await ALLOWED_ACTIONS[task.action.type](context);
        task.lastResult = { ok: true, message: resultText, at: task.lastRun };
    } catch (e) {
        task.lastResult = { ok: false, message: e?.message || String(e), at: task.lastRun };
    }
    if (task.schedule.type === "once") {
        task.enabled = false;
        task.nextRun = null;
    } else {
        task.nextRun = computeNextRun(task.schedule, new Date());
    }
    persist();
    return task.lastResult;
}

/** Manual "Run now" from the Dashboard - still only ever an allowed action. */
export async function runTask(id, context) {
    const task = getTask(id);
    if (!task) return { ok: false, reason: "not_found" };
    const result = await runTaskNow(task, context);
    return { ok: true, result };
}

async function tick(context) {
    if (running) return; // re-entrancy guard - a slow action can't overlap the next tick
    running = true;
    try {
        const now = Date.now();
        for (const task of load()) {
            if (!task.enabled || !task.nextRun) continue;
            if (Date.parse(task.nextRun) <= now) {
                await runTaskNow(task, context);
            }
        }
    } finally {
        running = false;
    }
}

/**
 * Starts the single central scheduler timer. Idempotent - calling this
 * more than once (e.g. after a Dashboard restart) never creates a second
 * timer (Stage 8, item #13: "لا تضاعف Scheduler بعد Reload").
 */
export function startScheduler(context) {
    if (timer) return;
    const seconds = getSettings().schedulerTickSeconds;
    timer = setInterval(() => {
        tick(context).catch(() => {});
    }, Math.max(10, seconds) * 1000);
    if (timer.unref) timer.unref();
}

/** Stage 8, item #5/#13 - clean shutdown, no leaked timers. */
export function stopScheduler() {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
}

/**
 * Stage 9, item #1 (Watchdog) - read-only health probe. Does not start or
 * stop anything; just reports whether the single central timer is
 * currently active, so the Watchdog can tell "scheduler stopped
 * unexpectedly" apart from "scheduler was never enabled" (e.g. login
 * mode / Dashboard disabled, where nothing is wrong).
 */
export function isSchedulerRunning() {
    return timer !== null;
}

/** Backup & Recovery (Stage 8, item #8). */
export function exportTasks() {
    return load().map((t) => ({ ...t }));
}

export function importTasks(list) {
    const next = [];
    if (Array.isArray(list)) {
        for (const t of list) {
            if (!t || typeof t !== "object") continue;
            if (!t.id || !t.name || !ALLOWED_ACTIONS[t.action?.type]) continue;
            const scheduleCheck = validateSchedule(t.schedule);
            if (!scheduleCheck.ok) continue;
            next.push({
                id: String(t.id),
                name: String(t.name).slice(0, 100),
                schedule: t.schedule,
                action: { type: t.action.type },
                enabled: Boolean(t.enabled),
                createdAt: t.createdAt || new Date().toISOString(),
                lastRun: t.lastRun || null,
                nextRun: t.enabled ? computeNextRun(t.schedule) : null,
                lastResult: t.lastResult || null,
            });
        }
    }
    tasks = next;
    persist();
}
