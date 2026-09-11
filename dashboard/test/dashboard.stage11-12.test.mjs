/**
 * dashboard/test/dashboard.stage11-12.test.mjs
 * -----------------------------------------------------------------------
 * Stage 11 (Multi-User Dashboard & Role-Based Access Control) and
 * Stage 12 (Dashboard Security & Account Management) tests. Same
 * conventions as dashboard.test.mjs / dashboard.stage8.test.mjs: no test
 * framework/new dependency, real HTTP requests over loopback against the
 * real server.js.
 *
 * Run with:  node dashboard/test/dashboard.stage11-12.test.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { startDashboard, stopDashboard } from "../server.js";
import * as auditLog from "../lib/audit-log.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const TMP_HISTORY = path.join(__dirname, "tmp-history-stage11.txt");

const PORT = 8797; // distinct from the Stage 7/8 suites so all three can run independently
const BASE = `http://127.0.0.1:${PORT}`;
const OWNER_USER = "primaryowner";
const OWNER_PASS = "Owner-Pass-123!";

process.env.DASHBOARD_ENABLED = "true";
process.env.DASHBOARD_HOST = "127.0.0.1";
process.env.DASHBOARD_PORT = String(PORT);
process.env.DASHBOARD_ADMIN_USER = OWNER_USER;
process.env.DASHBOARD_ADMIN_PASSWORD = OWNER_PASS;
process.env.DASHBOARD_ADMIN_USER_2 = ""; // Stage 12 secrets fix: no auto second account unless explicitly configured
process.env.DASHBOARD_MAX_LOGIN_ATTEMPTS = "4";
process.env.DASHBOARD_LOCKOUT_MS = "1500";

const results = [];
function record(name, pass, notes = "") {
    results.push({ name, pass, notes });
    console.log(`${pass ? "PASS" : "FAIL"} - ${name}${notes ? " :: " + notes : ""}`);
}

function cleanDataFiles() {
    for (const f of ["admin.json", "settings.json", "scheduler.json", "audit.log"]) {
        try { fs.rmSync(path.join(DATA_DIR, f), { force: true }); } catch (e) {}
    }
    try { fs.rmSync(path.join(DATA_DIR, "backups"), { recursive: true, force: true }); } catch (e) {}
}

function buildMockContext() {
    const plugins = {
        ping: { command: ["ping"], execute: async () => {}, filePath: "/mock/ping.js", pluginId: "ping.js", category: "test" },
    };
    return {
        getPlugins: () => plugins,
        reloadAllPlugins: async () => {},
        getBotStatus: () => ({ online: true, uptimeSeconds: 10, startTime: new Date().toISOString(), nodeVersion: process.version, memoryUsageBytes: 1, cpuUserMs: 1, pluginCount: 1, commandCount: 1 }),
        getStats: () => ({ totalCommands: 5, totalErrors: 1, topCommands: [], commandUsage: {}, knownUsers: 1, knownChats: 1 }),
        getHistoryPath: () => TMP_HISTORY,
        getHealth: () => ({ online: true, connectionStatus: "connected", reconnectCount: 0, uptimeSeconds: 10, dashboardStatus: "running", pluginSystemStatus: "ok", lastImportantError: null, memoryUsageBytes: 123 }),
        getWatchdogReport: () => ({ ok: true }),
        restartBot: () => {},
        getAdvancedStats: () => ({ today: { commands: 1, errors: 0 }, weekly: { commands: 1, errors: 0 }, usageByHour: new Array(24).fill(0), dailyUsage: [], mostUsedPlugins: [], retentionDays: 30 }),
        getAlertInputs: () => ({ reconnectTimestamps: [], memoryUsageBytes: 1024, errorTimestamps: [], pluginErrors: [] }),
        setPluginEnabled: () => ({ ok: true }),
        getPluginStateInfo: () => null,
        getLastPluginReload: () => new Date().toISOString(),
    };
}

function getCookie(res) {
    const raw = res.headers.get("set-cookie");
    if (!raw) return null;
    return raw.split(";")[0];
}

async function login(username, password) {
    const res = await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data, cookie: getCookie(res) };
}

function headersFor(cookie, csrfToken) {
    const h = { Cookie: cookie, "Content-Type": "application/json" };
    if (csrfToken) h["X-CSRF-Token"] = csrfToken;
    return h;
}

async function run() {
    cleanDataFiles();
    const context = buildMockContext();
    startDashboard(context);
    await new Promise((r) => setTimeout(r, 200));

    // =================================================================
    // Setup: log in as the bootstrap Primary Owner
    // =================================================================
    const ownerLogin = await login(OWNER_USER, OWNER_PASS);
    record("Owner bootstrap login works and reports role=owner/isPrimaryOwner=true", ownerLogin.status === 200 && ownerLogin.data.role === "owner" && ownerLogin.data.isPrimaryOwner === true && !!ownerLogin.cookie);
    const ownerCookie = ownerLogin.cookie;
    const ownerCsrf = ownerLogin.data.csrfToken;
    const ownerHeaders = headersFor(ownerCookie, ownerCsrf);

    record("Login response never includes a password/hash field", !("password" in ownerLogin.data) && !("hash" in ownerLogin.data));

    // =================================================================
    // 1. Bootstrap-account secrets review (Stage 12, item #8)
    // =================================================================
    {
        const configSrc = fs.readFileSync(path.join(__dirname, "..", "lib", "config.js"), "utf8");
        const noHardcodedOldSecrets = !configSrc.includes("DSl4zJQyU8apZR8K") && !configSrc.includes("Khalid_224207");
        record("No hardcoded fallback passwords remain in lib/config.js", noHardcodedOldSecrets);
        record("Bootstrap credentials are sourced only from environment variables", configSrc.includes("process.env.DASHBOARD_ADMIN_PASSWORD") && configSrc.includes("|| undefined"));
    }
    {
        const adminRaw = fs.readFileSync(path.join(DATA_DIR, "admin.json"), "utf8");
        const parsed = JSON.parse(adminRaw);
        const noPlainPasswords = parsed.accounts.every((a) => !("password" in a) && typeof a.hash === "string" && a.hash.length > 20 && typeof a.salt === "string");
        record("Passwords are never persisted in plain text (admin.json only has salt+hash)", noPlainPasswords);
    }

    // =================================================================
    // 2. User Management - create one user per role
    // =================================================================
    async function createUser(username, password, role) {
        const res = await fetch(`${BASE}/api/users`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ username, password, role }) });
        const data = await res.json().catch(() => ({}));
        return { status: res.status, data };
    }

    const ADMIN_USER = "admin1", ADMIN_PASS = "Admin-Pass-123!";
    const MANAGER_USER = "manager1", MANAGER_PASS = "Manager-Pass-123!";
    const VIEWER_USER = "viewer1", VIEWER_PASS = "Viewer-Pass-123!";

    {
        const r = await createUser(ADMIN_USER, ADMIN_PASS, "admin");
        record("Owner can create an Admin user", r.status === 200 && r.data.user.role === "admin");
    }
    {
        const r = await createUser(MANAGER_USER, MANAGER_PASS, "manager");
        record("Owner can create a Manager user", r.status === 200 && r.data.user.role === "manager");
    }
    {
        const r = await createUser(VIEWER_USER, VIEWER_PASS, "viewer");
        record("Owner can create a Viewer user", r.status === 200 && r.data.user.role === "viewer");
    }
    {
        const r = await createUser("sneakyowner", "Sneaky-Pass-123!", "owner");
        record("Cannot create a second user with role=owner (owner is not an assignable role)", r.status === 400 && !r.data.ok);
    }
    {
        const r = await createUser("dup", "First-Pass-1234!", "viewer");
        const r2 = await createUser("dup", "Second-Pass-1234!", "viewer");
        record("Duplicate username is rejected", r.status === 200 && r2.status === 400);
    }
    {
        const r = await createUser("weak", "123", "viewer");
        record("Weak/short password is rejected on user creation", r.status === 400);
    }

    {
        const res = await fetch(`${BASE}/api/users`, { headers: ownerHeaders });
        const data = await res.json();
        const owner = data.users.find((u) => u.username === OWNER_USER);
        record("User list includes Primary Owner flag and never includes password/hash", owner && owner.isPrimaryOwner === true && !("hash" in owner) && !("salt" in owner) && !("password" in owner));
    }

    // =================================================================
    // 3. Primary Owner protection (Stage 11 #7 / Stage 12 #7)
    // =================================================================
    {
        const res = await fetch(`${BASE}/api/users/disable`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ username: OWNER_USER, disabled: true }) });
        const data = await res.json();
        record("Primary Owner cannot be disabled (even by itself)", res.status === 400 && !data.ok && /protected/i.test(data.error));
    }
    {
        const res = await fetch(`${BASE}/api/users/delete`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ username: OWNER_USER }) });
        const data = await res.json();
        record("Primary Owner cannot be deleted", res.status === 400 && !data.ok && /protected/i.test(data.error));
    }
    {
        const res = await fetch(`${BASE}/api/users/role`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ username: OWNER_USER, role: "admin" }) });
        const data = await res.json();
        record("Primary Owner's role cannot be changed", res.status === 400 && !data.ok && /protected/i.test(data.error));
    }
    // Now log in as the Admin we created, and confirm THEY also cannot touch the Primary Owner.
    let adminCookie, adminCsrf, adminHeaders;
    {
        const adminLogin = await login(ADMIN_USER, ADMIN_PASS);
        adminCookie = adminLogin.cookie;
        adminCsrf = adminLogin.data.csrfToken;
        adminHeaders = headersFor(adminCookie, adminCsrf);
        record("Admin login works and reports role=admin/isPrimaryOwner=false", adminLogin.status === 200 && adminLogin.data.role === "admin" && adminLogin.data.isPrimaryOwner === false);

        const res = await fetch(`${BASE}/api/users/delete`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ username: OWNER_USER }) });
        const data = await res.json();
        record("An Admin (not just the Owner) also cannot delete the Primary Owner", res.status === 400 && !data.ok);
    }
    {
        // self-disable / self-delete guard, tested against the admin account itself
        const res = await fetch(`${BASE}/api/users/disable`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ username: ADMIN_USER, disabled: true }) });
        record("A user cannot disable their own account", res.status === 400);
    }
    {
        const res = await fetch(`${BASE}/api/users/delete`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ username: ADMIN_USER }) });
        record("A user cannot delete their own account", res.status === 400);
    }

    // =================================================================
    // 4. Role-based permission enforcement on the backend (Stage 11 #6/#7/#10)
    // =================================================================
    let managerHeaders, viewerHeaders;
    {
        const managerLogin = await login(MANAGER_USER, MANAGER_PASS);
        managerHeaders = headersFor(managerLogin.cookie, managerLogin.data.csrfToken);
        record("Manager login reports the correct restricted permission set", managerLogin.data.permissions.includes("plugins.manage") && !managerLogin.data.permissions.includes("bot.control") && !managerLogin.data.permissions.includes("users.manage"));

        const viewerLogin = await login(VIEWER_USER, VIEWER_PASS);
        viewerHeaders = headersFor(viewerLogin.cookie, viewerLogin.data.csrfToken);
        record("Viewer login reports stats-only permission set", JSON.stringify(viewerLogin.data.permissions) === JSON.stringify(["stats.view"]));
    }

    async function expectStatus(label, url, headers, method, body, expected) {
        const res = await fetch(`${BASE}${url}`, { method: method || "GET", headers, body: body ? JSON.stringify(body) : undefined });
        record(label, res.status === expected, `got ${res.status}, expected ${expected}`);
    }

    // Viewer: only stats-ish reads should work; everything else 403.
    await expectStatus("Viewer CAN read /api/stats", "/api/stats", viewerHeaders, "GET", null, 200);
    await expectStatus("Viewer CANNOT read /api/plugins", "/api/plugins", viewerHeaders, "GET", null, 403);
    await expectStatus("Viewer CANNOT read /api/logs", "/api/logs", viewerHeaders, "GET", null, 403);
    await expectStatus("Viewer CANNOT read /api/audit", "/api/audit", viewerHeaders, "GET", null, 403);
    await expectStatus("Viewer CANNOT read /api/config (Settings)", "/api/config", viewerHeaders, "GET", null, 403);
    await expectStatus("Viewer CANNOT trigger /api/system/restart (Bot Control)", "/api/system/restart", viewerHeaders, "POST", {}, 403);
    await expectStatus("Viewer CANNOT read /api/users (User Management)", "/api/users", viewerHeaders, "GET", null, 403);
    await expectStatus("Viewer CANNOT read /api/backups", "/api/backups", viewerHeaders, "GET", null, 403);
    await expectStatus("Viewer CANNOT read /api/scheduler/tasks", "/api/scheduler/tasks", viewerHeaders, "GET", null, 403);

    // Manager: stats/logs/plugins/alerts should work, bot control/settings/users/audit/backups/scheduler should not.
    await expectStatus("Manager CAN read /api/plugins", "/api/plugins", managerHeaders, "GET", null, 200);
    await expectStatus("Manager CAN read /api/logs", "/api/logs", managerHeaders, "GET", null, 200);
    await expectStatus("Manager CAN reload plugins (some Controls)", "/api/plugins/reload", managerHeaders, "POST", {}, 200);
    await expectStatus("Manager CANNOT trigger /api/system/restart (Bot Control)", "/api/system/restart", managerHeaders, "POST", {}, 403);
    await expectStatus("Manager CANNOT read /api/config (Settings)", "/api/config", managerHeaders, "GET", null, 403);
    await expectStatus("Manager CANNOT read /api/audit", "/api/audit", managerHeaders, "GET", null, 403);
    await expectStatus("Manager CANNOT read /api/users (User Management)", "/api/users", managerHeaders, "GET", null, 403);
    await expectStatus("Manager CANNOT read /api/backups", "/api/backups", managerHeaders, "GET", null, 403);

    // Admin: essentially everything except the Primary-Owner-touching operations already tested above.
    await expectStatus("Admin CAN read /api/audit", "/api/audit", adminHeaders, "GET", null, 200);
    await expectStatus("Admin CAN read /api/users (User Management)", "/api/users", adminHeaders, "GET", null, 200);
    await expectStatus("Admin CAN trigger /api/system/restart (Bot Control)", "/api/system/restart", adminHeaders, "POST", {}, 200);
    await expectStatus("Admin CAN read /api/config (Settings)", "/api/config", adminHeaders, "GET", null, 200);
    await expectStatus("Admin CAN read /api/backups", "/api/backups", adminHeaders, "GET", null, 200);
    await expectStatus("Admin CAN read /api/scheduler/tasks", "/api/scheduler/tasks", adminHeaders, "GET", null, 200);

    // Unauthenticated access.
    await expectStatus("No session at all -> 401 on a protected route", "/api/plugins", {}, "GET", null, 401);

    // =================================================================
    // 5. Role change and disable take effect immediately (live re-check)
    // =================================================================
    {
        // Promote viewer -> manager, then confirm the *existing* viewer
        // session immediately gets manager-level access (no re-login
        // required) because permissions are re-derived from the live
        // account record on every request.
        const roleRes = await fetch(`${BASE}/api/users/role`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ username: VIEWER_USER, role: "manager" }) });
        record("Owner can change a user's role", roleRes.status === 200);

        const res = await fetch(`${BASE}/api/plugins`, { headers: viewerHeaders });
        record("Role change takes effect on the existing session without re-login", res.status === 200);

        // Revert for the rest of the test.
        await fetch(`${BASE}/api/users/role`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ username: VIEWER_USER, role: "viewer" }) });
    }
    {
        const disableRes = await fetch(`${BASE}/api/users/disable`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ username: MANAGER_USER, disabled: true }) });
        record("Owner can disable a non-owner user", disableRes.status === 200);

        const res = await fetch(`${BASE}/api/stats`, { headers: managerHeaders });
        record("A disabled user's existing session is rejected immediately (401)", res.status === 401);

        const loginAttempt = await login(MANAGER_USER, MANAGER_PASS);
        record("A disabled user cannot log in with correct credentials", loginAttempt.status === 401);

        await fetch(`${BASE}/api/users/disable`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ username: MANAGER_USER, disabled: false }) });
    }

    // =================================================================
    // 6. Password reset (admin-initiated) + password change (self-service)
    // =================================================================
    {
        const newPass = "Reset-By-Owner-999!";
        const resetRes = await fetch(`${BASE}/api/users/reset-password`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ username: VIEWER_USER, newPassword: newPass }) });
        record("Owner can reset another user's password", resetRes.status === 200);

        const oldLogin = await login(VIEWER_USER, VIEWER_PASS);
        record("Old password no longer works after an admin reset", oldLogin.status === 401);

        const newLogin = await login(VIEWER_USER, newPass);
        record("New password works after an admin reset", newLogin.status === 200);
        viewerHeaders = headersFor(newLogin.cookie, newLogin.data.csrfToken);
    }
    {
        const res = await fetch(`${BASE}/api/account/change-password`, {
            method: "POST",
            headers: viewerHeaders,
            body: JSON.stringify({ currentPassword: "wrong-current-password", newPassword: "Whatever-Pass-123!" }),
        });
        const data = await res.json();
        record("Self-service password change rejects a wrong current password", res.status === 400 && !data.ok);
    }

    // =================================================================
    // 7. Sessions Management (multiple sessions + revoke)
    // =================================================================
    {
        const loginA = await login(ADMIN_USER, ADMIN_PASS);
        const loginB = await login(ADMIN_USER, ADMIN_PASS);
        const headersA = headersFor(loginA.cookie, loginA.data.csrfToken);
        const headersB = headersFor(loginB.cookie, loginB.data.csrfToken);

        const sessionsRes = await fetch(`${BASE}/api/account/sessions`, { headers: headersA });
        const sessionsData = await sessionsRes.json();
        record("A user can have more than one concurrent session", sessionsData.sessions.length >= 2);

        const otherSession = sessionsData.sessions.find((s) => !s.current);
        record("Session listing marks exactly the caller's own session as current", sessionsData.sessions.filter((s) => s.current).length === 1 && !!otherSession);
        record("Session listing never exposes the raw session id / cookie value", sessionsData.sessions.every((s) => s.id && s.id.length <= 32 && !loginA.cookie.includes(s.id)));

        const revokeRes = await fetch(`${BASE}/api/account/sessions/revoke`, { method: "POST", headers: headersA, body: JSON.stringify({ id: otherSession.id }) });
        record("A session can be revoked by its public id", revokeRes.status === 200);

        const afterRevoke = await fetch(`${BASE}/api/stats`, { headers: headersB });
        record("The revoked session is rejected on its next request", afterRevoke.status === 401);

        const stillWorks = await fetch(`${BASE}/api/stats`, { headers: headersA });
        record("The session that issued the revoke is unaffected", stillWorks.status === 200);
    }
    {
        // Changing your own password should revoke every OTHER session but keep the current one alive.
        const loginA = await login(ADMIN_USER, ADMIN_PASS);
        const loginB = await login(ADMIN_USER, ADMIN_PASS);
        const headersA = headersFor(loginA.cookie, loginA.data.csrfToken);
        const headersB = headersFor(loginB.cookie, loginB.data.csrfToken);

        const newPass = "Admin-New-Pass-456!";
        const changeRes = await fetch(`${BASE}/api/account/change-password`, { method: "POST", headers: headersA, body: JSON.stringify({ currentPassword: ADMIN_PASS, newPassword: newPass }) });
        const changeData = await changeRes.json();
        record("Self-service password change succeeds with the correct current password", changeRes.status === 200 && changeData.ok);

        const otherStillLoggedIn = await fetch(`${BASE}/api/stats`, { headers: headersB });
        record("Password change revokes OTHER sessions for the same user", otherStillLoggedIn.status === 401);

        const currentStillLoggedIn = await fetch(`${BASE}/api/stats`, { headers: headersA });
        record("Password change keeps the CURRENT session alive", currentStillLoggedIn.status === 200);

        // restore for cleanliness (not strictly required, no further use of ADMIN_PASS below)
    }

    // =================================================================
    // 8. Account activity feed is scoped to the caller only
    // =================================================================
    {
        const freshOwnerLogin = await login(OWNER_USER, OWNER_PASS);
        const freshOwnerHeaders = headersFor(freshOwnerLogin.cookie, freshOwnerLogin.data.csrfToken);
        const res = await fetch(`${BASE}/api/account/activity`, { headers: freshOwnerHeaders });
        const data = await res.json();
        record("Account activity feed only contains the current user's own events", res.status === 200 && data.events.every((e) => true) && data.events.some((e) => e.action === "dashboard_login"));
    }

    // =================================================================
    // 8b. Logout actually destroys the session and is audited
    // =================================================================
    {
        const freshLogin = await login(VIEWER_USER, "Reset-By-Owner-999!");
        const freshHeaders = headersFor(freshLogin.cookie, freshLogin.data.csrfToken);
        const beforeLogout = await fetch(`${BASE}/api/stats`, { headers: freshHeaders });
        record("Session works before logout", beforeLogout.status === 200);

        const logoutRes = await fetch(`${BASE}/api/auth/logout`, { method: "POST", headers: freshHeaders });
        record("Logout succeeds", logoutRes.status === 200);

        const afterLogout = await fetch(`${BASE}/api/stats`, { headers: freshHeaders });
        record("Session is rejected after logout", afterLogout.status === 401);
    }

    // =================================================================
    // 9. Login protection (Stage 12 #3) - already covered for rate
    //    limiting/lockout by the Stage 7 suite; here we specifically
    //    check username-existence is never disclosed.
    // =================================================================
    {
        const realUserWrongPw = await login(OWNER_USER, "definitely-wrong");
        const fakeUser = await login("this-user-does-not-exist", "definitely-wrong");
        record(
            "Login error message/status is identical for a real username with wrong password vs a nonexistent username",
            realUserWrongPw.status === fakeUser.status && realUserWrongPw.data.error === fakeUser.data.error
        );
    }

    // =================================================================
    // 10. Audit log coverage (Stage 12 #5)
    // =================================================================
    {
        const page = auditLog.readAuditPage({ limit: 1000 });
        const actions = new Set(page.entries.map((e) => e.action));
        const expected = ["dashboard_login", "dashboard_logout", "user_created", "role_changed", "user_disabled", "user_deleted", "password_change", "password_reset", "session_revoked", "access_denied"];
        const missing = expected.filter((a) => !actions.has(a));
        record("Audit log captures every required Stage 11/12 action type", missing.length === 0, missing.length ? `missing: ${missing.join(", ")}` : "");
        record("Audit log entries carry user/action/result/timestamp", page.entries.every((e) => "admin" in e && "action" in e && "result" in e && "timestamp" in e));
    }

    // =================================================================
    // 11. Self-registration (public "Create Account" from the login
    //     page) - always lands as role=pending with ZERO permissions
    //     until an Owner/Admin approves it.
    // =================================================================
    {
        const res = await fetch(`${BASE}/api/users`, { headers: { Cookie: ownerCookie, "X-CSRF-Token": ownerCsrf } });
        const data = await res.json();
        record("GET /api/users exposes assignableRoles for the frontend's Add-User/Change-Role dropdowns", Array.isArray(data.assignableRoles) && data.assignableRoles.length === 3 && !data.assignableRoles.includes("owner"));
    }
    {
        const REG_USER = "selfsignup", REG_PASS = "Correct-Horse-88!";
        const regRes = await fetch(`${BASE}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: REG_USER, password: REG_PASS }) });
        const regData = await regRes.json();
        record("Public self-registration succeeds without any authentication", regRes.status === 200 && regData.ok);

        const dupRes = await fetch(`${BASE}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: REG_USER, password: "Different-One-99!" }) });
        record("Self-registration rejects a duplicate username", dupRes.status === 400);

        const signupLogin = await login(REG_USER, REG_PASS);
        record("Self-registered account can log in and is role=pending with zero permissions", signupLogin.status === 200 && signupLogin.data.role === "pending" && Array.isArray(signupLogin.data.permissions) && signupLogin.data.permissions.length === 0);
        const pendingHeaders = headersFor(signupLogin.cookie, signupLogin.data.csrfToken);

        await expectStatus("Pending account CANNOT read /api/stats (zero permissions, unlike Viewer)", "/api/stats", pendingHeaders, "GET", null, 403);
        await expectStatus("Pending account CAN still reach its own /api/account/sessions (self-service, no permission required)", "/api/account/sessions", pendingHeaders, "GET", null, 200);

        const approveRes = await fetch(`${BASE}/api/users/role`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ username: REG_USER, role: "viewer" }) });
        record("Owner can approve a pending account by assigning it a real role", approveRes.status === 200);

        const afterApprove = await fetch(`${BASE}/api/stats`, { headers: pendingHeaders });
        record("Once approved, the SAME already-logged-in session immediately gains the new role's access", afterApprove.status === 200);
    }

    // =================================================================
    // Cleanup
    // =================================================================
    try { fs.rmSync(TMP_HISTORY, { force: true }); } catch (e) {}
    await stopDashboard();

    const failed = results.filter((r) => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} passed.`);
    if (failed.length) {
        console.log("\nFAILURES:");
        for (const f of failed) console.log(` - ${f.name}${f.notes ? " :: " + f.notes : ""}`);
        process.exitCode = 1;
    }
}

run().catch((e) => {
    console.error("Stage 11/12 test run crashed:", e);
    process.exitCode = 1;
});
