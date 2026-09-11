/**
 * core/watchdog.selftest.mjs
 * -----------------------------------------------------------------------
 * Stage 9, item #19 (Testing).
 *
 * A minimal, dependency-free test for core/watchdog.js and
 * core/memoryGuard.js - the two Stage 9 modules that need neither
 * Baileys, a WhatsApp session, nor node_modules to exercise for real.
 * Run with: node core/watchdog.selftest.mjs
 *
 * This intentionally does NOT touch main.js, the Dashboard, or anything
 * WhatsApp-related - see the Stage 9 final report for what could and
 * could not be actually executed in this environment.
 */

import assert from 'assert';
import { createWatchdog, HEALTH } from './watchdog.js';
import { createMemoryGuard } from './memoryGuard.js';

let passed = 0;
let failed = 0;

async function test(name, fn) {
    try {
        await fn();
        console.log(`PASS - ${name}`);
        passed += 1;
    } catch (e) {
        console.log(`FAIL - ${name}: ${e?.message || e}`);
        failed += 1;
    }
}

await test('overall health is HEALTHY when every subsystem is healthy', async () => {
    const wd = createWatchdog({ intervalMs: 5000 });
    wd.registerSubsystem('a', { check: () => ({ healthy: true }) });
    wd.registerSubsystem('b', { check: () => ({ healthy: true }) });
    await wd.runCycle();
    assert.strictEqual(wd.getOverallHealth(), HEALTH.HEALTHY);
});

await test('a non-critical failing subsystem reports DEGRADED, not UNHEALTHY', async () => {
    const wd = createWatchdog({ intervalMs: 5000 });
    wd.registerSubsystem('flaky', { check: () => ({ healthy: false, detail: 'down' }), critical: false });
    await wd.runCycle();
    assert.strictEqual(wd.getOverallHealth(), HEALTH.DEGRADED);
});

await test('a critical failing subsystem reports UNHEALTHY overall', async () => {
    const wd = createWatchdog({ intervalMs: 5000 });
    wd.registerSubsystem('core-thing', { check: () => ({ healthy: false, detail: 'down' }), critical: true });
    await wd.runCycle();
    assert.strictEqual(wd.getOverallHealth(), HEALTH.UNHEALTHY);
});

await test('self-heal is attempted and recorded in recovery history', async () => {
    const wd = createWatchdog({ intervalMs: 5000 });
    let healCalls = 0;
    wd.registerSubsystem('svc', {
        check: () => ({ healthy: false, detail: 'broken' }),
        heal: () => { healCalls += 1; return { ok: true, detail: 'reloaded' }; },
        retryLimit: 3,
        cooldownMs: 0,
        backoffBaseMs: 0,
    });
    await wd.runCycle();
    assert.strictEqual(healCalls, 1);
    const report = wd.getReport();
    assert.strictEqual(report.recovery.totalAttempts, 1);
    assert.strictEqual(report.recovery.recentHistory[0].subsystem, 'svc');
    assert.strictEqual(report.recovery.recentHistory[0].result, 'success');
});

await test('self-heal never exceeds retryLimit (no restart loop)', async () => {
    const wd = createWatchdog({ intervalMs: 5000 });
    let healCalls = 0;
    wd.registerSubsystem('svc', {
        check: () => ({ healthy: false, detail: 'still broken' }),
        heal: () => { healCalls += 1; return { ok: false, detail: 'nope' }; },
        retryLimit: 2,
        cooldownMs: 0,
        backoffBaseMs: 0,
    });
    for (let i = 0; i < 10; i++) await wd.runCycle();
    assert.strictEqual(healCalls, 2, `expected exactly 2 heal attempts, got ${healCalls}`);
});

await test('a subsystem that recovers on its own resets its counters', async () => {
    const wd = createWatchdog({ intervalMs: 5000 });
    let broken = true;
    wd.registerSubsystem('svc', {
        check: () => ({ healthy: !broken }),
        heal: () => ({ ok: false }),
        retryLimit: 5,
        cooldownMs: 0,
        backoffBaseMs: 0,
    });
    await wd.runCycle();
    broken = false;
    await wd.runCycle();
    const report = wd.getReport();
    assert.strictEqual(report.subsystems.svc.health, HEALTH.HEALTHY);
    assert.strictEqual(report.subsystems.svc.recoveryAttempts, 0);
});

await test('start()/stop() are idempotent - never a second interval', async () => {
    const wd = createWatchdog({ intervalMs: 5000 });
    wd.start();
    wd.start();
    wd.start();
    assert.strictEqual(wd.isRunning(), true);
    wd.stop();
    wd.stop();
    assert.strictEqual(wd.isRunning(), false);
});

await test('a throwing check() is treated as unhealthy, never crashes the cycle', async () => {
    const wd = createWatchdog({ intervalMs: 5000 });
    wd.registerSubsystem('boom', { check: () => { throw new Error('kaboom'); } });
    await wd.runCycle(); // must not throw
    assert.strictEqual(wd.getReport().subsystems.boom.health, HEALTH.DEGRADED);
});

await test('a throwing heal() is treated as a failed recovery, never crashes the cycle', async () => {
    const wd = createWatchdog({ intervalMs: 5000 });
    wd.registerSubsystem('boom', {
        check: () => ({ healthy: false }),
        heal: () => { throw new Error('heal exploded'); },
        cooldownMs: 0,
        backoffBaseMs: 0,
    });
    await wd.runCycle(); // must not throw
    const report = wd.getReport();
    assert.strictEqual(report.recovery.recentHistory[0].result, 'failed');
});

await test('memoryGuard: healthy below warn threshold', async () => {
    const guard = createMemoryGuard({ warnMB: 999999, criticalMB: 9999999 });
    const result = await guard.check();
    assert.strictEqual(result.healthy, true);
    assert.strictEqual(result.level, 'ok');
});

await test('memoryGuard: reports critical (unhealthy) once over the critical threshold', async () => {
    const guard = createMemoryGuard({ warnMB: 1, criticalMB: 1 }); // any real process is over 1MB
    const result = await guard.check();
    assert.strictEqual(result.healthy, false);
    assert.strictEqual(result.level, 'critical');
});

await test('memoryGuard: heal() runs registered cleanup tasks', async () => {
    const guard = createMemoryGuard({ warnMB: 1, criticalMB: 1, cleanupCooldownMs: 0 });
    let ran = false;
    guard.registerCleanupTask('trim-cache', () => { ran = true; });
    await guard.heal();
    assert.strictEqual(ran, true);
});

await test('memoryGuard: a failing cleanup task never blocks the others', async () => {
    const guard = createMemoryGuard({ warnMB: 1, criticalMB: 1, cleanupCooldownMs: 0 });
    let secondRan = false;
    guard.registerCleanupTask('bad', () => { throw new Error('nope'); });
    guard.registerCleanupTask('good', () => { secondRan = true; });
    await guard.heal();
    assert.strictEqual(secondRan, true);
});

await test('memoryGuard: shouldForceRestart only trips after sustained critical readings', async () => {
    const guard = createMemoryGuard({ warnMB: 1, criticalMB: 1 });
    await guard.check();
    assert.strictEqual(guard.shouldForceRestart(3), false);
    await guard.check();
    await guard.check();
    assert.strictEqual(guard.shouldForceRestart(3), true);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
