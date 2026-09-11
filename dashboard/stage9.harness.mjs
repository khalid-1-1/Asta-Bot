/**
 * dashboard/stage9.harness.mjs
 * -----------------------------------------------------------------------
 * NOT part of the shipped bot. A throwaway test harness for Stage 9's
 * final report: starts the REAL dashboard/server.js (unmodified) against
 * a small mock `context` object (the exact same shape main.js's
 * buildDashboardContext() builds) so the Stage 9 additions - /api/health's
 * new watchdog fields, /api/watchdog, /api/recovery, and
 * /api/system/restart - can be exercised with real HTTP requests instead
 * of only reviewed by eye. No WhatsApp session, no Baileys, and no
 * node_modules are needed for this, because dashboard/server.js and all
 * of dashboard/lib/* are dependency-free (see server.js's own header
 * comment).
 *
 * Run with: node dashboard/stage9.harness.mjs
 */
import http from 'http';
import { startDashboard, stopDashboard } from './server.js';
import { createWatchdog } from '../core/watchdog.js';
import { createMemoryGuard } from '../core/memoryGuard.js';
import * as recoveryLog from './lib/recovery-log.js';

process.env.DASHBOARD_PORT = process.env.DASHBOARD_PORT || '18173';
process.env.DASHBOARD_ADMIN_USER = 'admin';
process.env.DASHBOARD_ADMIN_PASSWORD = 'stage9-harness-password';

const watchdog = createWatchdog({
    intervalMs: 5000,
    onRecovery: (entry) => recoveryLog.recordRecovery(entry),
});
const memoryGuard = createMemoryGuard({});

let restartCalls = 0;
let pluginsHealthy = false; // start unhealthy so we can observe a self-heal happen
let reloadCalls = 0;

watchdog.registerSubsystem('pluginSystem', {
    critical: true,
    retryLimit: 3,
    cooldownMs: 0,
    backoffBaseMs: 0,
    check: () => (pluginsHealthy ? { healthy: true, detail: 'ok' } : { healthy: false, detail: 'no plugins loaded' }),
    heal: () => {
        reloadCalls += 1;
        pluginsHealthy = true; // simulate a successful reload fixing it
        return { ok: true, detail: 'reloaded' };
    },
});
watchdog.registerSubsystem('memory', { critical: true, check: () => memoryGuard.check(), heal: () => memoryGuard.heal() });

const mockContext = {
    getBotStatus: () => ({ online: true, uptimeSeconds: 42, nodeVersion: process.version, memoryUsageBytes: process.memoryUsage().rss, cpuUserMs: 10, pluginCount: 3, commandCount: 12, startTime: new Date().toISOString() }),
    getStats: () => ({ totalCommands: 5, totalErrors: 0, topCommands: [{ command: 'menu', count: 5 }], commandUsage: {}, knownUsers: 2, knownChats: 1 }),
    getPlugins: () => ({ menu: { command: 'menu' } }),
    reloadAllPlugins: async () => { reloadCalls += 1; pluginsHealthy = true; },
    getAdvancedStats: () => ({ daily: {}, dailyUsage: [], mostUsedPlugins: [], errorsByCommand: [], errorsByPlugin: [], usageByHour: new Array(24).fill(0), retentionDays: 7 }),
    getAlertInputs: () => ({ reconnectTimestamps: [], memoryUsageBytes: process.memoryUsage().rss, errorTimestamps: [], pluginErrors: [] }),
    getHealth: () => {
        const wd = watchdog.getReport();
        return {
            online: true, connectionStatus: 'connected', lastSuccessfulConnection: new Date().toISOString(),
            reconnectCount: 0, lastReconnectTime: null, reconnectsLastHour: 0, uptimeSeconds: 42,
            dashboardStatus: 'running', pluginSystemStatus: pluginsHealthy ? 'ok' : 'not_loaded',
            lastImportantError: null, memoryUsageBytes: process.memoryUsage().rss,
            watchdogState: wd.state, watchdogSubsystems: wd.subsystems, recovery: wd.recovery, memory: memoryGuard.snapshot(),
        };
    },
    getWatchdogReport: () => watchdog.getReport(),
    restartBot: (admin) => { restartCalls += 1; return { ok: true, admin }; },
    getPluginStateInfo: () => null,
    getLastPluginReload: () => null,
    setPluginEnabled: () => ({ ok: true }),
    getHistoryPath: () => '/tmp/does-not-matter.txt',
};

function req(method, path, body, cookies) {
    return new Promise((resolve, reject) => {
        const data = body !== undefined ? JSON.stringify(body) : null;
        const r = http.request({
            host: '127.0.0.1', port: process.env.DASHBOARD_PORT, path, method,
            headers: {
                'Content-Type': 'application/json',
                ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
                ...(cookies ? { Cookie: cookies } : {}),
            },
        }, (res) => {
            let chunks = '';
            res.on('data', (c) => (chunks += c));
            res.on('end', () => {
                let json = null;
                try { json = JSON.parse(chunks); } catch (e) {}
                resolve({ status: res.statusCode, headers: res.headers, json, raw: chunks });
            });
        });
        r.on('error', reject);
        if (data) r.write(data);
        r.end();
    });
}

let passed = 0, failed = 0;
function check(name, cond, extra) {
    if (cond) { console.log(`PASS - ${name}`); passed++; }
    else { console.log(`FAIL - ${name} ${extra ? JSON.stringify(extra) : ''}`); failed++; }
}

async function main() {
    startDashboard(mockContext);
    await new Promise((r) => setTimeout(r, 300)); // let the HTTP server actually bind

    // 1. Unauthenticated request to a protected endpoint must be rejected.
    const unauth = await req('GET', '/api/health');
    check('unauthenticated /api/health is rejected', unauth.status === 401, unauth);

    // 2. Login.
    const login = await req('POST', '/api/auth/login', { username: 'admin', password: 'stage9-harness-password' });
    check('login succeeds', login.status === 200 && login.json?.ok === true, login);
    const setCookie = login.headers['set-cookie']?.[0]?.split(';')[0];
    const csrf = login.json?.csrfToken;
    check('login returns a csrf token', !!csrf, login.json);

    // 3. /api/health includes the new Stage 9 fields.
    const health = await req('GET', '/api/health', undefined, setCookie);
    check('/api/health ok', health.status === 200 && health.json?.ok === true, health);
    check('/api/health has watchdogState', typeof health.json?.health?.watchdogState === 'string', health.json);
    check('/api/health has recovery block', typeof health.json?.health?.recovery?.totalAttempts === 'number', health.json);
    check('/api/health has memory snapshot', typeof health.json?.health?.memory?.rssMB === 'number', health.json);

    // 4. /api/watchdog full report.
    const wd = await req('GET', '/api/watchdog', undefined, setCookie);
    check('/api/watchdog ok', wd.status === 200 && wd.json?.ok === true, wd);
    check('/api/watchdog reports pluginSystem subsystem', !!wd.json?.watchdog?.subsystems?.pluginSystem, wd.json);

    // 5. Run a watchdog cycle - pluginSystem is unhealthy, should self-heal.
    // Note: `health` for a cycle reflects that cycle's check() result,
    // which runs BEFORE heal() - so it still reads UNHEALTHY right after
    // this cycle. The self-heal having *run* is confirmed by reloadCalls;
    // that it *worked* is confirmed on the next cycle's check() below.
    await watchdog.runCycle();
    check('watchdog self-healed pluginSystem (heal() was called)', reloadCalls === 1, { reloadCalls });

    await watchdog.runCycle(); // next cycle's check() should now see the fix
    const wd2 = await req('GET', '/api/watchdog', undefined, setCookie);
    check('pluginSystem now reports HEALTHY after self-heal', wd2.json?.watchdog?.subsystems?.pluginSystem?.health === 'HEALTHY', wd2.json?.watchdog?.subsystems?.pluginSystem);

    // 6. Recovery history should now have one entry, readable via /api/recovery.
    const rec = await req('GET', '/api/recovery', undefined, setCookie);
    check('/api/recovery ok', rec.status === 200 && rec.json?.ok === true, rec);
    check('/api/recovery has at least one entry', Array.isArray(rec.json?.entries) && rec.json.entries.length >= 1, rec.json);
    check('/api/recovery entry has no secret-looking fields', (rec.json.entries || []).every(e => !('password' in e) && !('token' in e) && !('key' in e)), rec.json);

    // 7. Restart without CSRF token must be rejected (item #16 - CSRF safety).
    const restartNoCsrf = await req('POST', '/api/system/restart', {}, setCookie);
    check('restart without CSRF token is rejected', restartNoCsrf.status === 403 || restartNoCsrf.status === 400, restartNoCsrf);
    check('restart without CSRF token did not call restartBot', restartCalls === 0, { restartCalls });

    // 8. Restart with a valid CSRF token succeeds and reaches context.restartBot().
    const restartWithCsrf = await new Promise((resolve, reject) => {
        const data = JSON.stringify({});
        const r = http.request({
            host: '127.0.0.1', port: process.env.DASHBOARD_PORT, path: '/api/system/restart', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), Cookie: setCookie, 'X-CSRF-Token': csrf },
        }, (res) => { let c = ''; res.on('data', (d) => (c += d)); res.on('end', () => { let j = null; try { j = JSON.parse(c); } catch (e) {} resolve({ status: res.statusCode, json: j }); }); });
        r.on('error', reject); r.write(data); r.end();
    });
    check('restart with CSRF token succeeds', restartWithCsrf.status === 200 && restartWithCsrf.json?.ok === true, restartWithCsrf);
    check('restart with CSRF token called context.restartBot()', restartCalls === 1, { restartCalls });

    // 9. Existing Stage 7/8 functionality still works unmodified.
    const plugins = await req('GET', '/api/plugins', undefined, setCookie);
    check('existing /api/plugins still works', plugins.status === 200 && plugins.json?.ok === true, plugins);
    const stats = await req('GET', '/api/stats', undefined, setCookie);
    check('existing /api/stats still works', stats.status === 200 && stats.json?.ok === true, stats);

    await stopDashboard();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error('HARNESS CRASHED:', e); process.exit(1); });
