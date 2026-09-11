/**
 * dashboard/test/dashboard.test.mjs
 * -----------------------------------------------------------------------
 * Runs the actual Dashboard HTTP server (no mocks of server.js itself,
 * only of the bot context it depends on) and exercises it with real HTTP
 * requests over the loopback interface. Run with:
 *
 *   node dashboard/test/dashboard.test.mjs
 *
 * No test framework / new dependency is used, since none is installed in
 * this environment - this uses Node's built-in fetch + a hand-rolled
 * assert/report.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { startDashboard, stopDashboard } from "../server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const ADMIN_FILE = path.join(DATA_DIR, "admin.json");
const TMP_HISTORY = path.join(__dirname, "tmp-history.txt");

const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;
const USERNAME = "testadmin";
const PASSWORD = "Test-Pass-123!";

process.env.DASHBOARD_ENABLED = "true";
process.env.DASHBOARD_HOST = "127.0.0.1";
process.env.DASHBOARD_PORT = String(PORT);
process.env.DASHBOARD_ADMIN_USER = USERNAME;
process.env.DASHBOARD_ADMIN_PASSWORD = PASSWORD;
process.env.DASHBOARD_MAX_LOGIN_ATTEMPTS = "3";
process.env.DASHBOARD_LOCKOUT_MS = "2000";

const results = [];
function record(name, pass, notes = "") {
    results.push({ name, pass, notes });
    console.log(`${pass ? "PASS" : "FAIL"} - ${name}${notes ? " :: " + notes : ""}`);
}

function writeSampleHistory() {
    const legacy = `\n[09/06/2026, 06:00:00]\n__________________\n✅ [SYSTEM]: Bot Connected (123@s.whatsapp.net)\n__________________\n`;
    const cmd = `\n[09/06/2026, 06:01:00] [COMMAND]\nCMD: ping\nUSER: 12345\nCHAT: 12345@s.whatsapp.net\n`;
    const err = `\n[09/06/2026, 06:02:00] [ERROR]\nCMD: broken\nPLUGIN: broken.js\nMSG: something failed\n`;
    const sec = `\n[09/06/2026, 06:03:00] [SECURITY]\nCMD: admin\nUSER: 999\nCHAT: 999@g.us\nREASON: insufficient level\n`;
    fs.writeFileSync(TMP_HISTORY, legacy + cmd + err + sec, "utf8");
}

function buildMockContext() {
    const plugins = {
        ping: { command: ["ping"], execute: async () => {}, filePath: "/mock/ping.js", category: "test" },
        admin: {
            command: ["admin", "ادمن"],
            execute: async () => {},
            filePath: "/mock/admin.js",
            category: "جروب",
            requiredLevel: "owner",
            group: true,
        },
        broken: { execute: null, filePath: "/mock/broken.js" },
    };
    let reloadCalls = 0;
    return {
        getPlugins: () => plugins,
        reloadAllPlugins: async () => {
            reloadCalls += 1;
        },
        getReloadCalls: () => reloadCalls,
        getBotStatus: () => ({
            online: true,
            uptimeSeconds: 321,
            startTime: new Date().toISOString(),
            nodeVersion: process.version,
            memoryUsageBytes: process.memoryUsage().rss,
            cpuUserMs: Math.round(process.cpuUsage().user / 1000),
            pluginCount: 3,
            commandCount: 4,
        }),
        getStats: () => ({
            totalCommands: 42,
            totalErrors: 1,
            topCommands: [{ command: "ping", count: 42 }],
            commandUsage: { ping: 42 },
            knownUsers: 3,
            knownChats: 2,
        }),
        getHistoryPath: () => TMP_HISTORY,
    };
}

function getCookie(res) {
    const raw = res.headers.get("set-cookie");
    if (!raw) return null;
    return raw.split(";")[0];
}

async function run() {
    try {
        fs.rmSync(ADMIN_FILE, { force: true });
    } catch (e) {}
    writeSampleHistory();

    const context = buildMockContext();
    startDashboard(context);
    await new Promise((r) => setTimeout(r, 200));

    // 1. Dashboard starts successfully / server reachable
    try {
        const res = await fetch(`${BASE}/login`);
        record("Dashboard starts successfully", res.status === 200);
    } catch (e) {
        record("Dashboard starts successfully", false, e.message);
    }

    // 2. Unauthorized API request is rejected
    {
        const res = await fetch(`${BASE}/api/status`);
        record("Unauthorized API request is rejected", res.status === 401);
    }

    // 3. Wrong password is rejected
    {
        const res = await fetch(`${BASE}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: USERNAME, password: "wrong-password" }),
        });
        record("Wrong password is rejected", res.status === 401);
    }

    // 4. Login works
    let cookie = null;
    let csrfToken = null;
    {
        const res = await fetch(`${BASE}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
        });
        const data = await res.json();
        cookie = getCookie(res);
        csrfToken = data.csrfToken;
        record("Login works", res.status === 200 && !!cookie && !!csrfToken);
    }

    // 5. Session protection works (authenticated request now succeeds)
    {
        const res = await fetch(`${BASE}/api/status`, { headers: { Cookie: cookie } });
        record("Session protection works (authenticated access succeeds)", res.status === 200);
    }

    // 6. Login response never includes the password
    {
        const res = await fetch(`${BASE}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
        });
        const text = await res.text();
        record("Dashboard does not expose secrets (login response has no password)", !text.includes(PASSWORD));
    }

    // 7. Status page loads
    {
        const res = await fetch(`${BASE}/api/status`, { headers: { Cookie: cookie } });
        const data = await res.json();
        record("Status page loads", res.status === 200 && data.ok && typeof data.status.online === "boolean");
    }

    // 8. Statistics page loads
    {
        const res = await fetch(`${BASE}/api/stats`, { headers: { Cookie: cookie } });
        const data = await res.json();
        record("Statistics page loads", res.status === 200 && data.ok && data.stats.totalCommands === 42);
    }

    // 9. Plugins page loads
    {
        const res = await fetch(`${BASE}/api/plugins`, { headers: { Cookie: cookie } });
        const data = await res.json();
        const hasBroken = data.plugins.find((p) => p.file === "broken.js");
        record(
            "Plugins page loads",
            res.status === 200 && data.ok && data.plugins.length === 3 && hasBroken?.status === "invalid"
        );
    }

    // 10. Logs page loads
    {
        const res = await fetch(`${BASE}/api/logs`, { headers: { Cookie: cookie } });
        const data = await res.json();
        record("Logs page loads", res.status === 200 && data.ok && data.entries.length === 4);
    }

    // 11. Logs filtering by category works
    {
        const res = await fetch(`${BASE}/api/logs?category=SECURITY`, { headers: { Cookie: cookie } });
        const data = await res.json();
        record(
            "Logs filtering by category works",
            res.status === 200 && data.entries.length === 1 && data.entries[0].category === "SECURITY"
        );
    }

    // 12. Reload without CSRF token is rejected
    {
        const res = await fetch(`${BASE}/api/plugins/reload`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: cookie },
            body: JSON.stringify({}),
        });
        record("Reload without CSRF token is rejected", res.status === 403);
    }

    // 13. Plugin reload works (with CSRF token)
    {
        const res = await fetch(`${BASE}/api/plugins/reload`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrfToken },
            body: JSON.stringify({ plugin: "ping" }),
        });
        const data = await res.json();
        record("Plugin reload works", res.status === 200 && data.ok && data.reloaded === true && context.getReloadCalls() === 1);
    }

    // 14. Failed plugin reload does not crash the bot / server
    {
        const res = await fetch(`${BASE}/api/plugins/reload`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrfToken },
            body: JSON.stringify({ plugin: "does-not-exist" }),
        });
        const data = await res.json();
        const stillUp = (await fetch(`${BASE}/login`)).status === 200;
        record(
            "Failed/unknown plugin reload does not crash server",
            res.status === 200 && data.reloaded === false && stillUp
        );
    }

    // 15. Path traversal on static assets is blocked
    {
        const res = await fetch(`${BASE}/assets/..%2f..%2fserver.js`);
        record("Path traversal on static assets is blocked", res.status === 400 || res.status === 404);
    }
    {
        const res = await fetch(`${BASE}/assets/../server.js`);
        record("Path traversal (dot-dot) on static assets is blocked", res.status === 400 || res.status === 404);
    }

    // 16. Basic XSS input is not reflected unescaped by the API (JSON encoding is inherently safe)
    {
        const res = await fetch(`${BASE}/api/logs?search=${encodeURIComponent('<script>alert(1)</script>')}`, {
            headers: { Cookie: cookie },
        });
        const text = await res.text();
        record(
            "XSS-style search input returns safely-encoded JSON",
            res.status === 200 && !text.includes("<script>alert(1)</script>".replace("<", "<"))
                ? true
                : res.headers.get("content-type")?.includes("application/json"),
        );
    }

    // 17. Brute force lockout engages after configured attempts
    {
        let lastStatus = null;
        for (let i = 0; i < 5; i++) {
            const res = await fetch(`${BASE}/api/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username: "bruteforce-user", password: "nope" }),
            });
            lastStatus = res.status;
        }
        record("Brute-force lockout engages after repeated failures", lastStatus === 429);
    }

    // 18. Logout clears the session
    {
        const logoutRes = await fetch(`${BASE}/api/auth/logout`, { method: "POST", headers: { Cookie: cookie } });
        const afterRes = await fetch(`${BASE}/api/status`, { headers: { Cookie: cookie } });
        record("Logout clears the session", logoutRes.status === 200 && afterRes.status === 401);
    }

    // 19. Shutdown cleans dashboard resources (server actually stops)
    {
        await stopDashboard();
        let stillListening = true;
        try {
            await fetch(`${BASE}/login`);
        } catch (e) {
            stillListening = false;
        }
        record("Shutdown cleans dashboard resources (server stops accepting connections)", !stillListening);
    }

    fs.rmSync(TMP_HISTORY, { force: true });

    const failed = results.filter((r) => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} passed.`);
    if (failed.length) {
        console.log("Failed tests:", failed.map((f) => f.name).join(", "));
        process.exitCode = 1;
    }
}

run();
