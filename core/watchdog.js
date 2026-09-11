/**
 * core/watchdog.js
 * -----------------------------------------------------------------------
 * Stage 9, items #1 and #2 (Watchdog System / Self-Healing).
 *
 * A small, dependency-free, generic engine. It does not know anything
 * about WhatsApp, plugins, or the Dashboard - main.js registers each
 * real subsystem with a `check()` (and, optionally, a `heal()`)
 * function. This keeps the engine itself trivially testable in
 * isolation (see core/watchdog.selftest.mjs) without needing Baileys,
 * a WhatsApp session, or any npm dependency at all.
 *
 * Design constraints this file exists to satisfy:
 *   - ONE central timer for every subsystem (item #17: no timer-per-
 *     plugin/user/recovery). start()/stop() are idempotent, matching the
 *     exact convention dashboard/lib/scheduler.js already uses.
 *   - No restart loops (item #2): every subsystem's self-heal attempts
 *     are bounded by retryLimit + cooldown/backoff. Once the retry
 *     budget is exhausted, the engine stops attempting heals for that
 *     subsystem (it stays reported as unhealthy) instead of retrying
 *     forever.
 *   - "Node process is running" is never treated as "healthy" (item #1)
 *     - overall health is derived only from the registered subsystem
 *       checks.
 *   - Recovery history never records secrets (item #12) - callers only
 *     ever pass subsystem name + short text details built in code, never
 *     raw error objects or credentials.
 */

export const HEALTH = Object.freeze({
    HEALTHY: 'HEALTHY',
    DEGRADED: 'DEGRADED',
    UNHEALTHY: 'UNHEALTHY',
});

export function createWatchdog(options = {}) {
    const {
        intervalMs = Number.parseInt(process.env.WATCHDOG_INTERVAL_MS, 10) || 30_000,
        maxHistoryEntries = 200,
        onRecovery = null, // optional callback(entry) - e.g. persist to a log file
    } = options;

    const subsystems = new Map(); // name -> definition
    const state = new Map(); // name -> runtime state
    const history = []; // bounded ring buffer, oldest first
    let timer = null;
    let cycleRunning = false;
    let totalAttempts = 0;
    let totalFailures = 0;
    let lastRecovery = null;

    function pushHistory(entry) {
        history.push(entry);
        if (history.length > maxHistoryEntries) history.shift();
        totalAttempts += 1;
        if (entry.result !== 'success') totalFailures += 1;
        lastRecovery = entry;
        if (typeof onRecovery === 'function') {
            try {
                onRecovery(entry);
            } catch (e) {
                /* a broken listener must never break the watchdog itself */
            }
        }
    }

    /**
     * Registers a subsystem to watch.
     *   check(): () => { healthy: boolean, detail?: string } | Promise<...>
     *   heal():  optional () => { ok: boolean, detail?: string } | Promise<...>
     *            Omit for check-only subsystems - e.g. the WhatsApp
     *            connection, which must rely on the existing reconnect
     *            system rather than a second, competing one (item #2).
     *   critical: if true, this subsystem being unhealthy makes the
     *             whole bot UNHEALTHY; otherwise it only makes it
     *             DEGRADED.
     */
    function registerSubsystem(name, def) {
        subsystems.set(name, {
            check: def.check,
            heal: def.heal || null,
            critical: !!def.critical,
            retryLimit: def.retryLimit ?? 3,
            cooldownMs: def.cooldownMs ?? 60_000,
            backoffBaseMs: def.backoffBaseMs ?? 5_000,
        });
        state.set(name, {
            health: HEALTH.HEALTHY,
            lastCheckAt: null,
            lastDetail: null,
            failCount: 0,
            recoveryAttempts: 0,
            lastAttemptAt: null,
            lastRecoveryResult: null,
            cooldownUntil: 0,
            retryBudgetExhausted: false,
        });
    }

    function unregisterSubsystem(name) {
        subsystems.delete(name);
        state.delete(name);
    }

    async function runOne(name, def, st) {
        let result;
        try {
            result = await def.check();
        } catch (e) {
            result = { healthy: false, detail: `check_threw: ${e?.message || e}` };
        }
        st.lastCheckAt = new Date().toISOString();
        st.lastDetail = result?.detail ?? null;

        if (result?.healthy) {
            if (st.failCount > 0 || st.health !== HEALTH.HEALTHY) {
                st.failCount = 0;
                st.recoveryAttempts = 0;
                st.retryBudgetExhausted = false;
            }
            st.health = HEALTH.HEALTHY;
            return;
        }

        st.failCount += 1;
        st.health = def.critical ? HEALTH.UNHEALTHY : HEALTH.DEGRADED;

        if (!def.heal) return; // check-only subsystem

        const now = Date.now();
        if (now < st.cooldownUntil) return; // still cooling down
        if (st.recoveryAttempts >= def.retryLimit) {
            st.retryBudgetExhausted = true;
            return; // never a restart loop - stop attempting
        }

        st.recoveryAttempts += 1;
        st.lastAttemptAt = new Date().toISOString();
        const backoff = def.backoffBaseMs * Math.pow(2, st.recoveryAttempts - 1);
        st.cooldownUntil = now + Math.max(def.cooldownMs, backoff);

        let healResult;
        try {
            healResult = await def.heal();
        } catch (e) {
            healResult = { ok: false, detail: `heal_threw: ${e?.message || e}` };
        }
        st.lastRecoveryResult = healResult?.ok ? 'success' : 'failed';

        pushHistory({
            time: st.lastAttemptAt,
            subsystem: name,
            problem: st.lastDetail || 'unhealthy',
            action: 'self_heal_attempt',
            attempt: st.recoveryAttempts,
            retryLimit: def.retryLimit,
            result: st.lastRecoveryResult,
            resultDetail: healResult?.detail ?? null,
        });
    }

    async function runCycle() {
        if (cycleRunning) return; // never overlapping cycles
        cycleRunning = true;
        try {
            for (const [name, def] of subsystems) {
                await runOne(name, def, state.get(name));
            }
        } finally {
            cycleRunning = false;
        }
    }

    function start() {
        if (timer) return; // idempotent - one central interval, ever
        timer = setInterval(() => {
            runCycle().catch(() => {});
        }, Math.max(5000, intervalMs));
        if (timer.unref) timer.unref();
    }

    function stop() {
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
    }

    function getOverallHealth() {
        let worst = HEALTH.HEALTHY;
        for (const st of state.values()) {
            if (st.health === HEALTH.UNHEALTHY) return HEALTH.UNHEALTHY;
            if (st.health === HEALTH.DEGRADED) worst = HEALTH.DEGRADED;
        }
        return worst;
    }

    function getReport() {
        const subsystemsReport = {};
        for (const [name, st] of state.entries()) subsystemsReport[name] = { ...st };
        return {
            state: getOverallHealth(),
            subsystems: subsystemsReport,
            recovery: {
                lastRecovery,
                totalAttempts,
                totalFailures,
                recentHistory: history.slice(-20).reverse(), // newest-first
            },
            generatedAt: new Date().toISOString(),
        };
    }

    return {
        HEALTH,
        registerSubsystem,
        unregisterSubsystem,
        start,
        stop,
        runCycle,
        getReport,
        getOverallHealth,
        isRunning: () => timer !== null,
    };
}
