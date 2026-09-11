/**
 * core/memoryGuard.js
 * -----------------------------------------------------------------------
 * Stage 9, item #6 (Memory Protection).
 *
 * Exposes a Watchdog-compatible { check, heal } pair plus a small
 * cleanup-task registry other subsystems can use to shed memory when
 * asked. Deliberately does NOT call global.gc()/require `--expose-gc`
 * (explicitly prohibited by item #6) and does NOT restart the process by
 * itself - `shouldForceRestart()` is only ever consulted by main.js, and
 * only acts on it when the operator has explicitly opted in via the
 * WATCHDOG_AUTO_RESTART_ON_CRITICAL_MEMORY env var (default: off), which
 * is item #6's "لا تعمل Restart تلقائي إلا إذا كان ذلك ضروريًا وآمنًا جدًا".
 */

export function createMemoryGuard(options = {}) {
    const warnMB = options.warnMB ?? (Number.parseInt(process.env.WATCHDOG_MEM_WARN_MB, 10) || 350);
    const criticalMB = options.criticalMB ?? (Number.parseInt(process.env.WATCHDOG_MEM_CRITICAL_MB, 10) || 600);
    const cleanupCooldownMs = options.cleanupCooldownMs ?? 30_000;

    const cleanupTasks = new Map(); // name -> fn
    let consecutiveCritical = 0;
    let lastCleanupAt = 0;

    function registerCleanupTask(name, fn) {
        cleanupTasks.set(name, fn);
    }

    function unregisterCleanupTask(name) {
        cleanupTasks.delete(name);
    }

    function snapshot() {
        const mem = process.memoryUsage();
        return {
            rssMB: Math.round(mem.rss / 1024 / 1024),
            heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
            heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
            externalMB: Math.round(mem.external / 1024 / 1024),
        };
    }

    async function runCleanupTasks() {
        const now = Date.now();
        if (now - lastCleanupAt < cleanupCooldownMs) return { ran: false, reason: 'cooldown' };
        lastCleanupAt = now;
        let ranCount = 0;
        for (const [, fn] of cleanupTasks) {
            try {
                await fn();
                ranCount += 1;
            } catch (e) {
                /* one failing cleanup task must never block the others */
            }
        }
        return { ran: true, ranCount };
    }

    /** Watchdog-compatible check(). Only CRITICAL sustained usage is ever
     *  reported unhealthy - a WARN-level reading is still "healthy" so a
     *  brief spike never trips self-healing or dashboard alerts on its
     *  own. */
    async function check() {
        const mem = snapshot();
        if (mem.rssMB >= criticalMB) {
            consecutiveCritical += 1;
            return { healthy: false, detail: `critical: rss=${mem.rssMB}MB (limit ${criticalMB}MB), consecutive=${consecutiveCritical}`, mem, level: 'critical' };
        }
        consecutiveCritical = 0;
        if (mem.rssMB >= warnMB) {
            return { healthy: true, detail: `warn: rss=${mem.rssMB}MB (limit ${warnMB}MB)`, mem, level: 'warn' };
        }
        return { healthy: true, detail: `ok: rss=${mem.rssMB}MB`, mem, level: 'ok' };
    }

    /** Watchdog-compatible heal(): best-effort cleanup only. */
    async function heal() {
        const result = await runCleanupTasks();
        return {
            ok: true,
            detail: result.ran
                ? `ran ${result.ranCount}/${cleanupTasks.size} cleanup task(s)`
                : `cleanup skipped (${result.reason})`,
        };
    }

    /** True once memory has been CRITICAL for `minConsecutive` checks in a
     *  row. main.js only acts on this if explicitly opted in. */
    function shouldForceRestart(minConsecutive = 5) {
        return consecutiveCritical >= minConsecutive;
    }

    return {
        registerCleanupTask,
        unregisterCleanupTask,
        snapshot,
        check,
        heal,
        shouldForceRestart,
        warnMB,
        criticalMB,
    };
}
