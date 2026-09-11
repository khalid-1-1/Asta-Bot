import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, jidNormalizedUser } from '@whiskeysockets/baileys';
import fs from 'fs-extra';
import pino from 'pino';
import path from 'path';
import chalk from 'chalk';
import readline from 'readline';
import { fileURLToPath, pathToFileURL } from 'url';
import crypto from 'crypto';
import os from 'os';
import delay from 'delay';
import axios from "axios";
import { pipeline } from "stream/promises";

import { startDashboard, stopDashboard, isDashboardRunning } from './dashboard/server.js'; // Stage 7, Stage 9 item #1
import * as dashboardNotifications from './dashboard/lib/notifications.js'; // Stage 8, item #9

// Stage 9 (Production Hardening & Self-Healing) - additive on top of
// Stage 1-8. None of these imports change how the bot connects,
// reconnects, loads plugins, or dispatches commands; they only observe
// and, where explicitly safe, self-heal the existing systems.
import { createWatchdog } from './core/watchdog.js';
import { createMemoryGuard } from './core/memoryGuard.js';
import * as recoveryLog from './dashboard/lib/recovery-log.js';
import * as dashboardScheduler from './dashboard/lib/scheduler.js'; // Stage 9, item #1 - same singleton module Stage 8's server.js already drives; only isSchedulerRunning()/start/stop are used here as read-only probes + bounded self-heal
import { monitorEventLoopDelay } from 'perf_hooks';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROCESS_START_ISO = new Date().toISOString();

// Single Bot Instance: all bot resources (asta/, handlers/, utils/,
// plugins/) live directly at the project root - no more per-account
// folders under accounts/.
const RESOURCE_DIR = __dirname;

const sessionDir = path.join(__dirname, 'ملف_الاتصال');




const question = (text) =>
  new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(text, (answer) => { rl.close(); resolve(answer); });
  });




let handleMessages, initializePlugins, elitePro, config;
let play, playError, playLogout, logger;
let themeData = { asciiArt: '', soundPath: '', themeColor: 'FF6BFF' };

// Stage 7 (Dashboard) state - additive, never read by Stage 1-6 code.
let dashboardGetPlugins, dashboardLoadPlugins, dashboardGetStats, dashboardGetHistoryPath;
let dashboardStarted = false;
let botIsOnline = false;

// Stage 8 (Advanced Bot Management) state - additive on top of Stage 7.
// Every one of these is read-only telemetry: nothing here changes how the
// bot connects, reconnects, or dispatches commands.
let dashboardIsCommandDisabled, dashboardSetPluginEnabledByCommand, dashboardGetPluginStateInfo,
    dashboardGetLastPluginReload, dashboardExportPluginState, dashboardImportPluginState,
    dashboardGetAllPluginErrorCounts;
let dashboardGetAdvancedStats, dashboardGetLastTelemetryError, dashboardGetErrorTimestamps;
let flushTelemetryStats = null; // Stage 9, item #4/#9

let lastSuccessfulConnectionIso = null;
let lastReconnectIso = null;
let reconnectCount = 0;
// Bounded, short-lived timestamps window (Stage 8, item #3 - "Reconnect
// متكرر خلال فترة قصيرة"). Never grows unbounded: pruned to the last hour
// on every push, capped at 50 entries defensively even if the clock is off.
const reconnectTimestamps = [];
function recordReconnect() {
    reconnectCount += 1;
    lastReconnectIso = new Date().toISOString();
    const now = Date.now();
    reconnectTimestamps.push(now);
    const cutoff = now - 60 * 60 * 1000;
    while (reconnectTimestamps.length && (reconnectTimestamps[0] < cutoff || reconnectTimestamps.length > 50)) {
        reconnectTimestamps.shift();
    }
    try { dashboardNotifications.notifyReconnect(`إعادة اتصال بالبوت (المرة رقم ${reconnectCount}).`); } catch (e) {}
}

let lastImportantError = null; // { message, at, source }
function recordImportantError(source, err) {
    lastImportantError = { message: err?.message || String(err), at: new Date().toISOString(), source };
    try { dashboardNotifications.notifyError(`خطأ (${source}): ${lastImportantError.message}`); } catch (e) {}
}

// -----------------------------------------------------------------------
// Stage 9: Watchdog System / Self-Healing / Memory Protection.
//
// One central Watchdog instance for this bot process. It watches every
// subsystem that exists in this single-instance process (plugin system,
// Dashboard, Scheduler, etc.) - see startWatchdogOnce() below, called at
// the same point Stage 7 starts the Dashboard.
// -----------------------------------------------------------------------

const watchdog = createWatchdog({
    intervalMs: Number.parseInt(process.env.WATCHDOG_INTERVAL_MS, 10) || 30_000,
    onRecovery: (entry) => {
        // Item #12 (Recovery History) - append-only, secrets-free log.
        try { recoveryLog.recordRecovery(entry); } catch (e) {}
        try {
            dashboardNotifications.notifyAdminAction(
                `Self-healing: [${entry.subsystem}] ${entry.problem || ''} -> ${entry.action} (attempt ${entry.attempt}/${entry.retryLimit}): ${entry.result}.`
            );
        } catch (e) {}
    },
});

const memoryGuard = createMemoryGuard({}); // thresholds read from WATCHDOG_MEM_WARN_MB / WATCHDOG_MEM_CRITICAL_MB env vars, sane defaults otherwise

// Item #1 - "Main event loop" monitoring. Built into Node (perf_hooks),
// zero dependencies, zero extra timers: it samples the event loop's own
// delay, it doesn't need one.
const eventLoopDelayMonitor = monitorEventLoopDelay({ resolution: 20 });
eventLoopDelayMonitor.enable();

let watchdogStarted = false;

/**
 * Registers every subsystem exactly once. Safe to call multiple times
 * (e.g. once per reconnect's bootstrapSystem() run) - registering the
 * same name again simply replaces its definition with an equivalent one
 * and does not create a duplicate entry (core/watchdog.js keys
 * subsystems by name in a Map).
 */
function registerWatchdogSubsystems() {
    // Connection - CHECK-ONLY (item #2's explicit rule: never a second,
    // competing reconnect system). A short grace period after a
    // disconnect is normal (the existing `setTimeout(startBot, 3000)`
    // reconnect is expected to already be in flight) - only a
    // disconnect that outlives that grace period is reported unhealthy.
    watchdog.registerSubsystem('connection', {
        critical: false, // already handled elsewhere; Watchdog only reports it
        check: () => {
            if (botIsOnline) return { healthy: true, detail: 'connected' };
            const sinceIso = lastReconnectIso || lastSuccessfulConnectionIso || PROCESS_START_ISO;
            const downForMs = Date.now() - new Date(sinceIso).getTime();
            const graceMs = 90_000;
            return downForMs > graceMs
                ? { healthy: false, detail: `disconnected for ${Math.round(downForMs / 1000)}s (existing reconnect system should be retrying)` }
                : { healthy: true, detail: 'disconnected, within normal reconnect grace period' };
        },
    });

    // Event loop - CHECK-ONLY (no automated action makes sense here; a
    // blocked loop can only really be fixed by a human/deploy fix, and
    // acting on it automatically would risk exactly the kind of
    // unnecessary restart item #6/#17 warn against).
    watchdog.registerSubsystem('eventLoop', {
        critical: false,
        check: () => {
            const meanMs = eventLoopDelayMonitor.mean / 1e6;
            const maxMs = eventLoopDelayMonitor.max / 1e6;
            eventLoopDelayMonitor.reset(); // measure the recent window, not the lifetime average
            const thresholdMs = Number.parseInt(process.env.WATCHDOG_EVENT_LOOP_MS, 10) || 300;
            const healthy = !(Number.isFinite(meanMs) && meanMs > thresholdMs);
            return { healthy, detail: `mean=${meanMs.toFixed(1)}ms max=${maxMs.toFixed(1)}ms (threshold ${thresholdMs}ms)` };
        },
    });

    // Memory - see core/memoryGuard.js. Cleanup tasks registered below.
    watchdog.registerSubsystem('memory', {
        critical: true, // check() only ever fails at sustained CRITICAL level
        retryLimit: 10,
        cooldownMs: 30_000,
        backoffBaseMs: 15_000,
        check: () => memoryGuard.check(),
        heal: () => memoryGuard.heal(),
    });
    // A couple of cheap, safe things this process can trim under memory
    // pressure without touching any user-visible state.
    memoryGuard.registerCleanupTask('trim-reconnect-timestamps', () => {
        const cutoff = Date.now() - 10 * 60 * 1000; // keep only the last 10 minutes instead of 1 hour
        while (reconnectTimestamps.length && reconnectTimestamps[0] < cutoff) reconnectTimestamps.shift();
    });

    // Plugin system - CRITICAL: if the bot is online but has zero loaded
    // plugins/commands, it effectively can't serve any command.
    watchdog.registerSubsystem('pluginSystem', {
        critical: true,
        retryLimit: 3,
        cooldownMs: 2 * 60 * 1000,
        backoffBaseMs: 10_000,
        check: () => {
            if (!botIsOnline) return { healthy: true, detail: 'bot offline - plugin system not applicable yet' };
            const { pluginCount, commandCount } = countPluginsAndCommands();
            return (pluginCount > 0 || commandCount > 0)
                ? { healthy: true, detail: `${pluginCount} plugins / ${commandCount} commands loaded` }
                : { healthy: false, detail: 'no plugins loaded while bot is online' };
        },
        heal: async () => {
            if (!dashboardLoadPlugins) return { ok: false, detail: 'plugin loader not ready yet' };
            await dashboardLoadPlugins(themeData.themeColor);
            return { ok: true, detail: 'reloaded all plugins' };
        },
    });

    // Dashboard - non-critical (item #14: a Dashboard failure must never
    // take the bot itself down). Only checked if it was actually
    // supposed to be running (Stage 7's own enabled/login-mode gate).
    watchdog.registerSubsystem('dashboard', {
        critical: false,
        retryLimit: 3,
        cooldownMs: 2 * 60 * 1000,
        backoffBaseMs: 15_000,
        check: () => {
            if (!dashboardStarted) return { healthy: true, detail: 'dashboard not enabled for this run' };
            return isDashboardRunning()
                ? { healthy: true, detail: 'running' }
                : { healthy: false, detail: 'dashboard was started but its HTTP server is not running' };
        },
        heal: async () => {
            try { await stopDashboard(); } catch (e) {}
            try {
                startDashboard(buildDashboardContext());
                return { ok: true, detail: 'restarted dashboard' };
            } catch (e) {
                return { ok: false, detail: e?.message || String(e) };
            }
        },
    });

    // Scheduler - lives in dashboard/lib/scheduler.js (a singleton module,
    // same one Stage 8's server.js already drives). Non-critical: missed
    // scheduled tasks are not a bot-down condition.
    watchdog.registerSubsystem('scheduler', {
        critical: false,
        retryLimit: 3,
        cooldownMs: 2 * 60 * 1000,
        backoffBaseMs: 15_000,
        check: () => {
            if (!dashboardStarted) return { healthy: true, detail: 'dashboard/scheduler not enabled for this run' };
            return dashboardScheduler.isSchedulerRunning()
                ? { healthy: true, detail: 'running' }
                : { healthy: false, detail: 'scheduler timer is not running while dashboard is enabled' };
        },
        heal: () => {
            dashboardScheduler.stopScheduler();
            dashboardScheduler.startScheduler(buildDashboardContext());
            return { ok: true, detail: 'restarted scheduler timer' };
        },
    });

    // Logger - the account's central logger (handlers/console.js /
    // handlers/logger.js) already never throws by design (Stage 6/8).
    // This check exists mainly so a logger that somehow starts throwing
    // is caught and safely downgraded to `console`, rather than that
    // exception ever propagating into WhatsApp event handling.
    watchdog.registerSubsystem('logger', {
        critical: false,
        retryLimit: 2,
        cooldownMs: 5 * 60 * 1000,
        backoffBaseMs: 30_000,
        check: () => {
            try {
                const ok = logger && typeof logger.info === 'function' && typeof logger.error === 'function';
                return { healthy: !!ok, detail: ok ? 'ok' : 'logger missing expected methods' };
            } catch (e) {
                return { healthy: false, detail: `logger_threw: ${e?.message || e}` };
            }
        },
        heal: () => {
            // Never worse than what bootstrapSystem() already falls back
            // to on import failure - console never throws.
            logger = console;
            return { ok: true, detail: 'fell back to console logger' };
        },
    });

    // Statistics - best-effort telemetry; no restart-worthy action exists
    // for a stats read failure, so this is check-only and purely
    // informational for the Dashboard/report.
    watchdog.registerSubsystem('statistics', {
        critical: false,
        check: () => {
            try {
                dashboardGetStats ? dashboardGetStats() : null;
                return { healthy: true, detail: 'ok' };
            } catch (e) {
                return { healthy: false, detail: `stats_read_threw: ${e?.message || e}` };
            }
        },
    });
}

function startWatchdogOnce() {
    if (watchdogStarted) return;
    watchdogStarted = true;
    registerWatchdogSubsystems();
    watchdog.start();
}

function stopWatchdog() {
    watchdog.stop();
}

function countPluginsAndCommands() {
    try {
        const plugins = dashboardGetPlugins ? dashboardGetPlugins() : {};
        const commandCount = Object.keys(plugins).length;
        const pluginCount = new Set(Object.values(plugins)).size;
        return { pluginCount, commandCount };
    } catch (e) {
        return { pluginCount: 0, commandCount: 0 };
    }
}

function buildDashboardContext() {
    return {
        getPlugins: () => (dashboardGetPlugins ? dashboardGetPlugins() : {}),
        reloadAllPlugins: async () => {
            if (!dashboardLoadPlugins) throw new Error('Plugin loader not ready yet.');
            await dashboardLoadPlugins(themeData.themeColor);
        },
        getStats: () => (dashboardGetStats ? dashboardGetStats() : { totalCommands: 0, totalErrors: 0, topCommands: [], commandUsage: {}, knownUsers: 0, knownChats: 0 }),
        getHistoryPath: () => (dashboardGetHistoryPath ? dashboardGetHistoryPath() : ''),
        getBotStatus: () => {
            const { pluginCount, commandCount } = countPluginsAndCommands();
            return {
                online: botIsOnline,
                uptimeSeconds: process.uptime(),
                startTime: PROCESS_START_ISO,
                nodeVersion: process.version,
                memoryUsageBytes: process.memoryUsage().rss,
                cpuUserMs: Math.round(process.cpuUsage().user / 1000),
                pluginCount,
                commandCount,
            };
        },

        // -------------------------------------------------------------
        // Stage 8, item #1 (Health Monitoring). Purely additive read-only
        // telemetry on top of the exact same connection/plugin state
        // Stage 1-7 already track - no new listeners are created for this.
        // -------------------------------------------------------------
        getHealth: () => {
            const { pluginCount, commandCount } = countPluginsAndCommands();
            const wdReport = watchdog.getReport(); // Stage 9, item #1/#15
            return {
                online: botIsOnline,
                connectionStatus: botIsOnline ? "connected" : "disconnected",
                lastSuccessfulConnection: lastSuccessfulConnectionIso,
                reconnectCount,
                lastReconnectTime: lastReconnectIso,
                reconnectsLastHour: reconnectTimestamps.length,
                uptimeSeconds: process.uptime(),
                dashboardStatus: dashboardStarted ? "running" : "disabled",
                pluginSystemStatus: pluginCount > 0 || commandCount > 0 ? "ok" : "not_loaded",
                lastImportantError: lastImportantError || (dashboardGetLastTelemetryError ? dashboardGetLastTelemetryError() : null),
                memoryUsageBytes: process.memoryUsage().rss,
                // Stage 9 additions - purely additive fields; nothing above
                // this line changed shape, so any existing Dashboard/API
                // consumer keeps working unmodified.
                watchdogState: watchdogStarted ? wdReport.state : "disabled",
                watchdogSubsystems: watchdogStarted ? wdReport.subsystems : {},
                recovery: watchdogStarted ? wdReport.recovery : { lastRecovery: null, totalAttempts: 0, totalFailures: 0, recentHistory: [] },
                memory: memoryGuard.snapshot(),
            };
        },

        // Stage 9, item #1/#15 (Watchdog / Dashboard Integration) - full
        // report, for a dedicated Dashboard page/section beyond the
        // summary fields folded into getHealth() above.
        getWatchdogReport: () => watchdog.getReport(),

        // Stage 9, item #5 (Graceful Restart) - see requestRestart() below.
        // Requires the same Dashboard session auth + CSRF check server.js
        // already applies to every other admin action (plugin
        // enable/disable/reload, config changes, backup/restore).
        restartBot: (admin) => requestRestart(`dashboard admin (${admin || 'unknown'})`),

        // -------------------------------------------------------------
        // Stage 8, item #2 (Advanced Statistics) - delegates entirely to
        // handlers/telemetry.js (developed in place, see bootstrapSystem).
        // -------------------------------------------------------------
        getAdvancedStats: () => (dashboardGetAdvancedStats ? dashboardGetAdvancedStats() : null),

        // -------------------------------------------------------------
        // Stage 8, item #4 (Advanced Plugin Management) - thin pass-through
        // to handlers/plugins.js + handlers/pluginState.js.
        // -------------------------------------------------------------
        isCommandDisabled: (command) => (dashboardIsCommandDisabled ? dashboardIsCommandDisabled(command) : false),
        setPluginEnabled: (command, enabled, admin) =>
            dashboardSetPluginEnabledByCommand
                ? dashboardSetPluginEnabledByCommand(command, enabled, { admin })
                : { ok: false, reason: "plugin_system_not_ready" },
        getPluginStateInfo: (command) => (dashboardGetPluginStateInfo ? dashboardGetPluginStateInfo(command) : null),
        getLastPluginReload: () => (dashboardGetLastPluginReload ? dashboardGetLastPluginReload() : null),
        exportPluginState: () => (dashboardExportPluginState ? dashboardExportPluginState() : {}),
        importPluginState: (map) => (dashboardImportPluginState ? dashboardImportPluginState(map) : null),

        // Used by Alerts (Stage 8, item #3) to evaluate reconnect-storm /
        // memory/error-spike/plugin-failure thresholds on demand (pull-based
        // - evaluated only when the Dashboard asks - no new timer at all).
        getAlertInputs: () => ({
            reconnectTimestamps: [...reconnectTimestamps],
            memoryUsageBytes: process.memoryUsage().rss,
            errorTimestamps: dashboardGetErrorTimestamps ? dashboardGetErrorTimestamps() : [],
            pluginErrors: dashboardGetAllPluginErrorCounts ? dashboardGetAllPluginErrorCounts() : [],
        }),
    };
}

function startDashboardOnce() {
    if (dashboardStarted) return;
    dashboardStarted = true;
    try {
        startDashboard(buildDashboardContext());
    } catch (e) {
        // Item #14: a Dashboard failure must never prevent the bot itself
        // from working.
        console.error('[Dashboard] Failed to start:', e?.message || e);
        recordImportantError('dashboard', e);
    }
}

async function shutdownDashboard() {
    try {
        await stopDashboard();
    } catch (e) {
        /* best-effort */
    }
}

async function bootstrapSystem() {

    try {
        const utilsPath = path.join(RESOURCE_DIR, 'utils');

        const loggerModule = await import(pathToFileURL(path.join(utilsPath, 'console.js')).href);
        logger = loggerModule.default;
        

        const soundModule = await import(pathToFileURL(path.join(utilsPath, 'sound.js')).href);
        

        const soundStateFile = path.join(RESOURCE_DIR, 'asta', 'themes', 'soundState.txt');
        const isSoundEnabled = () => {
            try {
                if (fs.existsSync(soundStateFile)) {
                    const content = fs.readFileSync(soundStateFile, 'utf-8').trim();
                    return content === '[on]';
                }
                return false;
            } catch (e) { return false; }
        };

        play = (filePath) => { if(isSoundEnabled()) soundModule.play(filePath); };
        playError = () => { if(isSoundEnabled()) soundModule.playError(); };
        playLogout = () => { if(isSoundEnabled()) soundModule.playLogout(); };

    } catch (e) { 
        logger = console;
        play = () => {}; playError = () => {}; playLogout = () => {};
    }


    try {
        const settingsPath = path.join(RESOURCE_DIR, 'asta', 'themes', 'settings.txt');
        if (fs.existsSync(settingsPath)) {
            const folderName = fs.readFileSync(settingsPath, 'utf-8').trim().replace(/[\[\]]/g, '');
            const themeFolder = path.join(RESOURCE_DIR, 'asta', 'themes', folderName);
            if (fs.existsSync(themeFolder)) {
                const jsFiles = (await fs.readdir(themeFolder)).filter(f => f.endsWith('.js'));
                if (jsFiles.length > 0) {
                    const asciiArtPath = path.join(themeFolder, jsFiles[0]);
                    const themeArt = await import(pathToFileURL(asciiArtPath).href);
                    const mp3Files = (await fs.readdir(themeFolder)).filter(f => f.endsWith('.mp3'));
                    const soundPath = mp3Files.length ? path.join(themeFolder, mp3Files[0]) : '';
                    const themeContent = fs.readFileSync(asciiArtPath, 'utf-8');
                    const match = themeContent.match(/chalk\.hex\(['"](#(?:[0-9A-Fa-f]{6}))['"]\)/);
                    themeData = { asciiArt: themeArt.asciiArt || '', soundPath, themeColor: match ? match[1] : 'FF6BFF' };
                }
            }
        }
    } catch (e) {}


    console.log(chalk.magenta('🚀 Loading Khalid Bot core...'));

    const configModule = await import(pathToFileURL(path.join(RESOURCE_DIR, 'asta', 'config.js')).href);
        config = configModule.default;

        const msgsModule = await import(pathToFileURL(path.join(RESOURCE_DIR, 'handlers', 'messages.js')).href);
        handleMessages = msgsModule.handleMessages;
        initializePlugins = msgsModule.initializePlugins;

        const eliteModule = await import(pathToFileURL(path.join(RESOURCE_DIR, 'handlers', 'elite-pro.js')).href);
        elitePro = eliteModule.default;

        // Stage 7 (Dashboard): reuse the exact same plugin loader and the
        // additive telemetry module - no second plugin scanner/loader is
        // created here.
        const pluginsModule = await import(pathToFileURL(path.join(RESOURCE_DIR, 'handlers', 'plugins.js')).href);
        dashboardGetPlugins = pluginsModule.getPlugins;
        dashboardLoadPlugins = pluginsModule.loadPlugins;

        // Stage 8, item #4 - same module, already-loaded exports. No second
        // plugin loader/enable-disable system is created.
        dashboardIsCommandDisabled = pluginsModule.isCommandDisabled;
        dashboardSetPluginEnabledByCommand = pluginsModule.setPluginEnabledByCommand;
        dashboardGetPluginStateInfo = pluginsModule.getPluginStateInfo;
        dashboardGetLastPluginReload = pluginsModule.getLastReloadTime;
        dashboardExportPluginState = pluginsModule.exportPluginState;
        dashboardImportPluginState = pluginsModule.importPluginState;
        dashboardGetAllPluginErrorCounts = pluginsModule.getAllPluginErrorCounts;

        try {
            const telemetryModule = await import(pathToFileURL(path.join(RESOURCE_DIR, 'handlers', 'telemetry.js')).href);
            dashboardGetStats = telemetryModule.getStats;
            dashboardGetHistoryPath = telemetryModule.getHistoryPath;
            // Stage 8, item #2 (Advanced Statistics) - developed in-place on
            // top of Stage 7's telemetry.js, not a second stats system.
            dashboardGetAdvancedStats = telemetryModule.getAdvancedStats;
            dashboardGetLastTelemetryError = telemetryModule.getLastError;
            dashboardGetErrorTimestamps = telemetryModule.getErrorTimestamps;
            // Stage 9, item #4/#9 - flush the debounced stats.json write
            // immediately during Graceful Shutdown, instead of losing up
            // to 2s of statistics to the debounce window.
            flushTelemetryStats = typeof telemetryModule.flushStatsNow === 'function' ? telemetryModule.flushStatsNow : null;
        } catch (e) {
            // telemetry.js is additive - if it's ever missing, the dashboard
            // still starts, it just reports empty statistics/logs.
            dashboardGetStats = () => ({ totalCommands: 0, totalErrors: 0, topCommands: [], commandUsage: {}, knownUsers: 0, knownChats: 0 });
            dashboardGetHistoryPath = () => path.join(RESOURCE_DIR, 'asta', 'data', 'History.txt');
            dashboardGetAdvancedStats = () => ({ daily: {}, dailyUsage: [], mostUsedPlugins: [], errorsByCommand: [], errorsByPlugin: [], usageByHour: new Array(24).fill(0), retentionDays: 0 });
            dashboardGetLastTelemetryError = () => null;
            dashboardGetErrorTimestamps = () => [];
            flushTelemetryStats = null;
        }
}


export async function startBot() {
  await bootstrapSystem();
  startWatchdogOnce(); // Stage 9, item #1 - once per process; startBot() re-runs on every reconnect

  try {
    if (themeData.asciiArt) console.log(themeData.asciiArt);
    if (themeData.soundPath) play(themeData.soundPath);

    await fs.ensureDir(sessionDir);
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();


    const sock = makeWASocket({
      auth: state,
      version,
      printQRInTerminal: false,
      browser: ['MacOS', 'Chrome', '1.0.0'],
      logger: pino({ level: 'silent' }),
      markOnlineOnConnect: true,
      syncFullHistory: false,
      getMessageHistory: async () => []
    });

    if (!sock.authState.creds.registered) {
      const bgColor = `#${themeData.themeColor}`;
      let phoneNumber;
      let pairingCode;

      if (config?.pairing?.phone) {
        phoneNumber = config.pairing.phone.replace(/[^0-9]/g, '');
      } else {
        const promptText = ' PHONE : ';

        while (true) {
          const input = await question(chalk.bgHex(bgColor).black(promptText));
          if (/^[0-9\s+\-\(\)]+$/.test(input) && input.trim().length > 0) {
              const clean = input.replace(/[^0-9]/g, '');
              if (clean.length > 6) { 
                  phoneNumber = clean; 
                  break; 
              } else {
                  console.log(chalk.red.bold("❌ Error: Phone number is too short."));
              }
          } else {
              console.log(chalk.red.bold("❌ Error: Please enter digits only."));
          }
        }
      }

      if (config?.pairing?.code) {
        pairingCode = config.pairing.code.toUpperCase().trim();
      } else {

        while (true) {
          const rawInput = await question(chalk.bgHex(bgColor).black(' Password (8 chars): '));
          const input = rawInput.trim();

          if (input.length !== 8) {
              console.log(chalk.red.bold("❌ Error: Password must be 8 chars."));
              continue;
          }


          const allowedRegex = /^[a-zA-Z0-9\u0600-\u06FF\u0400-\u04FF]+$/;
          if (!allowedRegex.test(input)) {
              console.log(chalk.red.bold("❌ Error: Invalid characters."));
              continue;
          }

          pairingCode = input.toUpperCase(); 
          break;
        }
      }

      try {
        await delay(1200);
        const code = await sock.requestPairingCode(phoneNumber, pairingCode);
        console.log('\n────────── Pairing Information ──────────');
        console.log(`Phone Number : ${phoneNumber}`);
        console.log(`Pairing Code : ${code}`);
        console.log('─────────────────────────────────────────\n');

      } catch (err) {
        console.log(chalk.red.bold(`\n❌ Pairing failed: ${err?.message || err}\n`));
        if(playError) playError();
        process.exit(1);
      }
    }

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === 'connecting') {
        if (logger) logger.info('Connecting to WhatsApp...');
      }

      if (connection === 'open') {
            logger.success('CONNECTED! Khalid Bot is online.');

            if(initializePlugins) await initializePlugins(themeData.themeColor);

            botIsOnline = true;
            lastSuccessfulConnectionIso = new Date().toISOString(); // Stage 8, item #1 - Health Monitoring
            startDashboardOnce(); // Stage 7 - safe no-op if already started or disabled
            

            try {
                const botJid = jidNormalizedUser(sock.user.id);
                if (elitePro && !(await elitePro.isElite({ sock, id: botJid }))) {
                    console.log(chalk.yellow(`⚠️ Adding Bot (${botJid}) to Elite...`));
                    await elitePro.addElite({ sock, ids: [botJid] });
                }
            } catch (e) {}
      }

      if (connection === 'close') {
        botIsOnline = false; // Stage 7 - dashboard status only, no behavior change
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut;
        const isBanned = statusCode === DisconnectReason.forbidden;


        if (statusCode === 408) {
            if(playError) playError();
            console.log(chalk.red.bold('\n──────────────────────────────────────────────────'));
            console.log(chalk.bgRed.white.bold(' ❌ INTERNET CONNECTION LOST (408) '));
            console.log(chalk.red(' Bot stopped due to lack of internet connection.'));
            console.log(chalk.red.bold('──────────────────────────────────────────────────\n'));
            process.exit(1); 
        }


        if (statusCode === 440) {
            if(playError) playError();
            console.log(chalk.magenta.bold('\n──────────────────────────────────────────────────'));
            console.log(chalk.bgMagenta.white.bold(' ⚠️ SECURITY ALERT (440) '));
            console.log(chalk.magenta(' Unknown party attempting to access session file.'));
            console.log(chalk.magenta(' Bot is preventing access.'));
            console.log(chalk.magenta(' If not you, please revoke session immediately.'));
            console.log(chalk.magenta.bold('──────────────────────────────────────────────────\n'));

        }

        
        if (isBanned) {
          if(playError) playError();
          console.log(chalk.red.bold('\n🚫 ACCOUNT BANNED! Send "3" to reset.\n'));
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
          rl.question('', async (answer) => {
            if (answer.trim() === '3') {
              rl.close();
              sock.end(undefined);
              await delay(1000);
              await fs.remove(sessionDir);
              process.send?.('reset');
              process.exit();
            } else { process.exit(0); }
          });
          return; 
        }


        if (isLoggedOut) {
          if(playLogout) playLogout();
          console.log(chalk.red.bold('\nLogged out. Send "2" to reset.\n'));
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
          rl.question('', async (answer) => {
            if (answer.trim() === '2') {
              rl.close();
              sock.end(undefined);
              await delay(1000);
              await fs.remove(sessionDir);
              process.send?.('reset');
              process.exit();
            } else { process.exit(0); }
          });
          return;
        }


        if (statusCode !== 408 && statusCode !== 440) {
            console.log(chalk.yellow(`Connection closed (${statusCode}). Reconnecting...`));
            recordReconnect(); // Stage 8, item #1 - Health Monitoring
            setTimeout(startBot, 3000);
        }
      }
    });

    sock.ev.on('messages.upsert', async (m) => {
        try {
            if(handleMessages) await handleMessages(sock, m);
        } catch (err) {}
    });
    
const welcomeFormPath = path.join(process.cwd(), "asta", "welcomeGroups.json");
const welcomeMsgPath = path.join(process.cwd(), "asta", "welcome.json");

function loadJSON(file) {
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file));
}

sock.ev.on("group-participants.update", async (update) => {
  try {
    const { id, participants, action } = update;

    if (action !== "add") return;

    const formData = loadJSON(welcomeFormPath);
    const welcomeData = loadJSON(welcomeMsgPath);

    for (const user of participants) {
      await new Promise(r => setTimeout(r, 1500));

      const jid = user.id || user;
      const number = jid.split("@")[0];

      //  رسالة الاستمارة
      if (formData[id]) {
        await sock.sendMessage(id, {
          text: `> *عبي الإستمارة* @${number}
> *الألقاب المأخوذة في بايو الجروب*

*⎔━─╌ ⊱╎⌯🕸⌯╎⊰ ╌─━⎔*
*❀┊📃الاســتـقـبـال ➸*

*☘︎🔖 اختر شخصية انمي ↫「 」*
*☘︎🎴 من اي انمي ↫「 」*
*☘︎💭 من طرف مين ↫「 」*
*☘︎👥 ولد ام بنت ↫「 」*
*☘︎📅 عمرك ↫「 」*

*⎔┄─ ⊱╎⌯🕸⌯╎⊰ ─┄⎔*

*①🌌 ارسل صورة للشخصية الذي اخترتها*
*②🏷️مسموح لقب من الأنمي، مانغا، مانهوا*
*③🚫 لازم تختار لقب على نفس جنسك*

*⎔━─╌ ⊱╎⌯🕸⌯╎⊰ ╌─━⎔*
*⸙مـع تـحـ🖊️ـيـات ادارة⤦𝐀𝐒𝐓*
*_【 𝑱. 𝑨. 𝑭. 𝑻 ◈|🕸|◈ 𝑬𝑺𝑷𝑨𝑫𝑨 】🝳_*`,
          mentions: [jid]
        });
      }

      //  رسالة الترحيب
      if (welcomeData[id]) {
        await sock.sendMessage(id, {
          text: `*❈║══─╵🕸╷─══║❈*
*🌟نـوࢪتـنـا ✨*
*أهلاً بك في اسبادا نتمنى أن تستمتع بوقتك و أن تقضي وقتًا رائعًا معنا و نتشرف بمعرفتك و نأمل أن نصنع ذكريات جميلة معاً 🤍*

*↵📧┊المنشن ❰ @${number} ❱*

*❈║══─╵🕸╷─══║❈*

*_⸙ تـوقـ🖊️ـيـع⤦𝐀𝐒𝐓_*
*_【 𝑱. 𝑨. 𝑭. 𝑻 ◈|🕸|◈ 𝑬𝑺𝑷𝑨𝑫𝑨 】🝳_*`,
          mentions: [jid]
        });
      }
    }

  } catch (err) {
    console.log("WELCOME ERROR:", err);
  }
});

    sock.ev.on('creds.update', saveCreds);

  } catch (err) {
    console.error('Startup Error:', err);
    setTimeout(startBot, 3000);
  }
}

startBot();

// =========================================================================
// Stage 9: Crash Protection, Graceful Shutdown, Graceful Restart.
// =========================================================================

// Item #3 (Crash Protection). Neither of these handlers existed before
// Stage 9. Both only LOG - they never hide an error, and the logger call
// itself is wrapped so a broken logger can never turn one error into a
// crash. `uncaughtException` additionally triggers a graceful shutdown
// with a non-zero exit code so index.js's existing supervisor (which
// already implements retry-limit + backoff/cooldown - see index.js) can
// restart the process cleanly; this file does not re-implement its own
// competing restart-loop protection for that path.
function safeLog(level, ...args) {
    try {
        (logger && typeof logger[level] === 'function' ? logger : console)[level](...args);
    } catch (e) {
        try { console.error(...args); } catch (e2) { /* truly nothing left to do */ }
    }
}

// Bounded guard so a tight crash loop (e.g. an exception thrown again
// during shutdown cleanup itself) can never hang this process forever
// retrying cleanup - after a few uncaught exceptions in a short window,
// skip straight to a fast, uncleaned exit and let index.js's supervisor
// (which has its own retry-limit + backoff) take over.
let uncaughtExceptionTimestamps = [];
function isCrashingRepeatedly() {
    const now = Date.now();
    uncaughtExceptionTimestamps = uncaughtExceptionTimestamps.filter(t => now - t < 60_000);
    uncaughtExceptionTimestamps.push(now);
    return uncaughtExceptionTimestamps.length > 5;
}

process.on('unhandledRejection', (reason) => {
    // Promise rejections are logged and tracked, but do not by themselves
    // bring the process down - most are recoverable (a failed HTTP call,
    // a bad message payload) and index.js's crash-restart path is a much
    // blunter instrument than is warranted here.
    safeLog('error', 'Unhandled Promise Rejection:', reason?.message || reason);
    try { recordImportantError('unhandledRejection', reason instanceof Error ? reason : new Error(String(reason))); } catch (e) {}
});

process.on('uncaughtException', (err) => {
    safeLog('error', 'Uncaught Exception:', err?.message || err);
    try { recordImportantError('uncaughtException', err); } catch (e) {}
    if (isCrashingRepeatedly()) {
        process.exit(1); // skip cleanup - let the supervisor's backoff handle it
        return;
    }
    gracefulShutdown('uncaughtException', { exitCode: 1 });
});

// Item #4 (Graceful Shutdown). Order matches the spec: stop accepting
// new work first (Watchdog, so it can't kick off a new self-heal mid
// shutdown), then Scheduler, then Dashboard, then flush Statistics, then
// tidy up. A hard timeout guarantees this can never hang the process
// forever, whatever step it gets stuck on.
let shuttingDown = false;
async function gracefulShutdown(signal, { exitCode = 0 } = {}) {
    if (shuttingDown) return;
    shuttingDown = true;

    const forceExitTimer = setTimeout(() => {
        safeLog('error', `Graceful shutdown (${signal}) exceeded its timeout - forcing exit.`);
        process.exit(exitCode || 1);
    }, 8000);
    if (forceExitTimer.unref) forceExitTimer.unref();

    safeLog('info', `Shutting down (${signal})...`);

    try { stopWatchdog(); } catch (e) {}
    try { dashboardScheduler.stopScheduler(); } catch (e) {}
    try { await shutdownDashboard(); } catch (e) {}
    try { if (flushTelemetryStats) flushTelemetryStats(); } catch (e) {}

    clearTimeout(forceExitTimer);
    process.exit(exitCode);
}
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Item #5 (Graceful Restart). Reuses the exact restart primitive that
// already exists in handlers/settings.js's performRestart() (send
// 'reset' to the parent supervisor via index.js's IPC channel, then
// exit) rather than inventing a second restart mechanism - this is just
// that same primitive, reached through the same Graceful Shutdown path
// used above, and exposed to the Dashboard's already-authenticated admin
// session instead of only WhatsApp password-reset/account-deletion
// flows. It never accepts or forwards any argument from the caller.
let restarting = false;
export async function requestRestart(reason = 'unspecified') {
    if (restarting) return { ok: false, reason: 'restart_already_in_progress' };
    restarting = true;
    safeLog('info', `Restart requested (${reason}).`);
    try {
        dashboardNotifications.notifyAdminAction(`إعادة تشغيل البوت - السبب: ${reason}.`);
    } catch (e) {}

    const forceExitTimer = setTimeout(() => {
        try { process.send?.('reset'); } catch (e) {}
        process.exit(0);
    }, 8000);
    if (forceExitTimer.unref) forceExitTimer.unref();

    try { stopWatchdog(); } catch (e) {}
    try { dashboardScheduler.stopScheduler(); } catch (e) {}
    try { await shutdownDashboard(); } catch (e) {}
    try { if (flushTelemetryStats) flushTelemetryStats(); } catch (e) {}

    clearTimeout(forceExitTimer);
    try { process.send?.('reset'); } catch (e) {}
    process.exit(0);
    return { ok: true };
}
