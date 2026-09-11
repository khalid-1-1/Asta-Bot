/**
 * dashboard/lib/config.js
 * -----------------------------------------------------------------------
 * Stage 7 - Dashboard configuration.
 *
 * Everything here is read from environment variables with safe defaults.
 * Nothing sensitive (passwords, secrets) lives in this file or is ever
 * written into anything served to the browser.
 */

function bool(value, fallback) {
    if (value === undefined || value === null || value === "") return fallback;
    return String(value).trim().toLowerCase() === "true" || value === "1";
}

export function loadConfig() {
    return {
        // Master on/off switch. If false, startDashboard() is a no-op and
        // the bot boots exactly as it did before Stage 7 existed.
        enabled: bool(process.env.DASHBOARD_ENABLED, true),

        host: process.env.DASHBOARD_HOST || "127.0.0.1",
        port: Number.parseInt(process.env.DASHBOARD_PORT, 10) || 8787,

        // How long a login session stays valid without activity.
        sessionTtlMs: Number.parseInt(process.env.DASHBOARD_SESSION_TTL_MS, 10) || 4 * 60 * 60 * 1000,

        // Optional bootstrap admin credentials (used only the very first
        // time the dashboard runs and that username does not exist yet).
        // If not provided, a random password is generated and printed to
        // the console ONCE - never persisted in plaintext, never logged
        // to any file. A second, independent account can optionally be
        // configured so two people can each use their own login instead
        // of sharing one.
        //
        // Stage 12 secrets review: earlier stages had hardcoded fallback
        // passwords here (two short literal strings baked into source).
        // Any real secret value must ONLY ever come from an environment
        // variable - never from a literal in source. If the env var is
        // unset, this now falls back to `undefined`, which auth-store.js's
        // ensureAccounts() treats as "generate a random password and
        // print it once", exactly like the second account already did.
        bootstrapUsername: process.env.DASHBOARD_ADMIN_USER || "admin",
        bootstrapPassword: process.env.DASHBOARD_ADMIN_PASSWORD || undefined,
        bootstrapUsername2: process.env.DASHBOARD_ADMIN_USER_2 || undefined,
        bootstrapPassword2: process.env.DASHBOARD_ADMIN_PASSWORD_2 || undefined,

        // Brute-force protection.
        maxLoginAttempts: Number.parseInt(process.env.DASHBOARD_MAX_LOGIN_ATTEMPTS, 10) || 5,
        lockoutMs: Number.parseInt(process.env.DASHBOARD_LOCKOUT_MS, 10) || 5 * 60 * 1000,

        // Polling interval the frontend is told to use for auto-refresh.
        pollIntervalMs: Number.parseInt(process.env.DASHBOARD_POLL_MS, 10) || 5000,

        // How many log lines a single /api/logs page request may return.
        logsPageSize: Number.parseInt(process.env.DASHBOARD_LOGS_PAGE_SIZE, 10) || 200,
    };
}
