/**
 * dashboard/lib/rate-limit.js
 * -----------------------------------------------------------------------
 * Very small in-memory brute-force guard for the login endpoint, keyed by
 * "ip::username" so one bad actor can't lock out a legitimate admin from a
 * different IP, and a distributed guesser can't cheaply enumerate many
 * usernames from one IP without still tripping the per-IP counter.
 */

export function createLoginLimiter({ maxAttempts, lockoutMs }) {
    const byKey = new Map(); // key -> { failures, lockedUntil }
    const byIp = new Map(); // ip -> { failures, lockedUntil }

    function isLocked(entry) {
        return entry && entry.lockedUntil && entry.lockedUntil > Date.now();
    }

    function check(ip, username) {
        const key = `${ip}::${username}`;
        const entryKey = byKey.get(key);
        const entryIp = byIp.get(ip);
        if (isLocked(entryKey) || isLocked(entryIp)) {
            const until = Math.max(entryKey?.lockedUntil || 0, entryIp?.lockedUntil || 0);
            return { allowed: false, retryAfterMs: until - Date.now() };
        }
        return { allowed: true };
    }

    function recordFailure(ip, username) {
        const key = `${ip}::${username}`;
        const entryKey = byKey.get(key) || { failures: 0, lockedUntil: 0 };
        entryKey.failures += 1;
        if (entryKey.failures >= maxAttempts) {
            entryKey.lockedUntil = Date.now() + lockoutMs;
            entryKey.failures = 0;
        }
        byKey.set(key, entryKey);

        const entryIp = byIp.get(ip) || { failures: 0, lockedUntil: 0 };
        entryIp.failures += 1;
        if (entryIp.failures >= maxAttempts * 3) {
            entryIp.lockedUntil = Date.now() + lockoutMs;
            entryIp.failures = 0;
        }
        byIp.set(ip, entryIp);
    }

    function recordSuccess(ip, username) {
        byKey.delete(`${ip}::${username}`);
        // Intentionally do not clear the per-IP counter on one successful
        // login - a single stolen/guessed password shouldn't reset the
        // IP-wide guard for other usernames.
    }

    return { check, recordFailure, recordSuccess };
}
