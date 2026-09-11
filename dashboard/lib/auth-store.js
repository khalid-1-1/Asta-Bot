/**
 * dashboard/lib/auth-store.js
 * -----------------------------------------------------------------------
 * Owns the Dashboard's OWN user accounts (Stage 11/12).
 *
 * - Passwords are NEVER stored in plain text: only a scrypt hash + a
 *   per-account random salt are persisted to disk (dashboard/data/admin.json).
 * - Passwords are NEVER written to any log, and NEVER sent back to the
 *   frontend, at login, in listings, or otherwise.
 * - Every account now also carries a Dashboard *role* (see lib/roles.js),
 *   an enabled/disabled flag, and light metadata (created/last-login).
 * - Exactly one account is ever flagged `isPrimaryOwner: true`. That
 *   account cannot be deleted, disabled, demoted, or have its role
 *   changed by anyone (including itself) - see assertCanModifyTarget().
 *
 * This is a separate credential system from the bot's own WhatsApp
 * accounts/permissions - it does not touch, read, or modify
 * accounts/*, handlers/permissions.js, or the bot's own encryption
 * (Password Lock) system in any way.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { ROLES, ASSIGNABLE_ROLES, isValidRole } from "./roles.js";

const SCRYPT_KEYLEN = 64;
const MIN_PASSWORD_LENGTH = 8;

function scryptHash(password, salt) {
    return crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN).toString("hex");
}

function timingSafeEqualStrings(a, b) {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) {
        crypto.timingSafeEqual(bufA, bufA);
        return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
}

/** Minimal password strength check - no external dependency needed. */
function passwordPolicyError(password, username) {
    if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
        return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    if (username && password.toLowerCase().includes(String(username).toLowerCase())) {
        return "Password must not contain the username.";
    }
    return null;
}

export class AuthError extends Error {
    constructor(message, code = "auth_error") {
        super(message);
        this.code = code;
    }
}

export function createAuthStore(dataDir) {
    const filePath = path.join(dataDir, "admin.json");

    function ensureDir() {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    /**
     * Reads the account list from disk and transparently migrates older
     * shapes so existing installs never lose access:
     *   - Stage 7 legacy single-account shape: { username, salt, hash }
     *   - Stage 7-10 multi-account shape with NO role/owner metadata yet:
     *     { accounts: [{ username, salt, hash, createdAt }, ...] }
     * In both cases every account so far had full, equal access, so the
     * migration preserves that: the earliest-created account becomes the
     * new Primary Owner (role "owner", isPrimaryOwner: true), and every
     * other pre-existing account becomes role "admin" (still full
     * operational access, just not the un-touchable Primary Owner slot).
     * Migration is persisted back to disk the first time it runs.
     */
    function readAccounts() {
        let raw;
        try {
            raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
        } catch (e) {
            return [];
        }

        let accounts;
        if (Array.isArray(raw?.accounts)) {
            accounts = raw.accounts.filter((a) => a && a.username && a.salt && a.hash);
        } else if (raw && raw.username && raw.salt && raw.hash) {
            accounts = [raw]; // legacy single-account shape
        } else {
            return [];
        }

        const needsMigration = accounts.some((a) => !isValidRole(a.role)) || !accounts.some((a) => a.isPrimaryOwner);
        if (!needsMigration) return accounts;

        const sorted = [...accounts].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
        const primaryUsername = accounts.find((a) => a.isPrimaryOwner)?.username || sorted[0]?.username;

        const migrated = accounts.map((a) => ({
            ...a,
            role: a.isPrimaryOwner ? ROLES.OWNER : a.username === primaryUsername ? ROLES.OWNER : isValidRole(a.role) ? a.role : ROLES.ADMIN,
            isPrimaryOwner: a.username === primaryUsername,
            disabled: Boolean(a.disabled),
            createdAt: a.createdAt || new Date().toISOString(),
            lastLoginAt: a.lastLoginAt || null,
            lastLoginIp: a.lastLoginIp || null,
            passwordChangedAt: a.passwordChangedAt || a.createdAt || new Date().toISOString(),
        }));
        writeAccounts(migrated);
        return migrated;
    }

    function writeAccounts(accounts) {
        ensureDir();
        fs.writeFileSync(filePath, JSON.stringify({ accounts }, null, 2), { mode: 0o600 });
        try {
            fs.chmodSync(filePath, 0o600);
        } catch (e) {
            /* not fatal - hash is salted+hashed either way */
        }
    }

    function hashAccount(username, password, { role, isPrimaryOwner = false, createdBy = null } = {}) {
        const salt = crypto.randomBytes(16).toString("hex");
        const now = new Date().toISOString();
        return {
            username,
            salt,
            hash: scryptHash(password, salt),
            role,
            isPrimaryOwner,
            disabled: false,
            createdAt: now,
            createdBy,
            lastLoginAt: null,
            lastLoginIp: null,
            passwordChangedAt: now,
        };
    }

    /**
     * Makes sure the configured bootstrap admin account(s) exist. `wanted`
     * is an array of { username, password, role?, isPrimaryOwner? } -
     * password may be null/undefined, in which case a random one is
     * generated for that account. Existing accounts (by username) are
     * left untouched - this never overwrites a password someone already
     * set, and never re-assigns roles on an account that already exists.
     *
     * Returns { createdAccounts: [{ username, generatedPassword|null }], usernames: [...] }
     */
    function ensureAccounts(wanted) {
        const existing = readAccounts();
        const existingUsernames = new Set(existing.map((a) => a.username));
        const alreadyHasPrimaryOwner = existing.some((a) => a.isPrimaryOwner);
        const createdAccounts = [];
        const newOnes = [];
        let grantedPrimaryOwner = alreadyHasPrimaryOwner;

        for (const w of wanted) {
            const username = (w.username || "").trim();
            if (!username || existingUsernames.has(username)) continue;

            let generatedPassword = null;
            let password = w.password;
            if (!password) {
                generatedPassword = crypto.randomBytes(12).toString("base64url");
                password = generatedPassword;
            }

            // The very first bootstrap account ever created (when no
            // Primary Owner exists yet) becomes the Primary Owner. Any
            // additional bootstrap accounts default to "admin".
            const isPrimaryOwner = !grantedPrimaryOwner && w.isPrimaryOwner !== false;
            if (isPrimaryOwner) grantedPrimaryOwner = true;
            const role = isPrimaryOwner ? ROLES.OWNER : isValidRole(w.role) ? w.role : ROLES.ADMIN;

            newOnes.push(hashAccount(username, password, { role, isPrimaryOwner, createdBy: "bootstrap" }));
            createdAccounts.push({ username, generatedPassword, role });
            existingUsernames.add(username);
        }

        if (newOnes.length) writeAccounts([...existing, ...newOnes]);

        return {
            createdAccounts,
            usernames: [...existing.map((a) => a.username), ...newOnes.map((a) => a.username)],
        };
    }

    /**
     * Constant-time-ish credential check across all configured accounts.
     * Never throws; never logs the candidate password. Returns the
     * matched account (sanitized) on success, or null. A disabled
     * account never authenticates, but - to avoid leaking *why* a login
     * failed (Stage 12 requirement: never reveal whether a username
     * exists/is disabled) - a disabled account still runs through the
     * same-shaped hash comparison before being rejected.
     */
    function verify(username, password) {
        if (typeof username !== "string" || typeof password !== "string") return null;
        const accounts = readAccounts();

        const account = accounts.find((a) => timingSafeEqualStrings(a.username, username));
        const compareAgainst = account || { salt: crypto.randomBytes(16).toString("hex"), hash: "0".repeat(128) };

        let candidateHash;
        try {
            candidateHash = scryptHash(password, compareAgainst.salt);
        } catch (e) {
            return null;
        }
        const passwordMatches = timingSafeEqualStrings(compareAgainst.hash, candidateHash);

        if (!account || !passwordMatches || account.disabled) return null;
        return sanitize(account);
    }

    function findRaw(username) {
        return readAccounts().find((a) => a.username === username) || null;
    }

    function sanitize(account) {
        if (!account) return null;
        const { salt, hash, ...rest } = account;
        return rest;
    }

    function getUser(username) {
        return sanitize(findRaw(username));
    }

    function listUsers() {
        return readAccounts().map(sanitize);
    }

    function recordLogin(username, ip) {
        const accounts = readAccounts();
        const idx = accounts.findIndex((a) => a.username === username);
        if (idx === -1) return;
        accounts[idx] = { ...accounts[idx], lastLoginAt: new Date().toISOString(), lastLoginIp: ip || null };
        writeAccounts(accounts);
    }

    /**
     * Central "may this account be modified" gate, shared by every
     * mutating operation below. This is where the Primary Owner
     * protection actually lives (Stage 11 requirement #7 / Stage 12
     * requirement #7): nobody, including the Primary Owner itself acting
     * through the generic user-management API, can delete/disable/demote
     * the Primary Owner account through these endpoints.
     */
    function assertCanModifyTarget(target) {
        if (!target) throw new AuthError("User not found.", "not_found");
        if (target.isPrimaryOwner) {
            throw new AuthError("The Primary Owner account is protected and cannot be modified.", "primary_owner_protected");
        }
        return true;
    }

    /** Admin/Owner creates a new dashboard user. Never creates another owner. */
    function createUser({ username, password, role, createdBy }) {
        username = String(username || "").trim();
        if (!username || username.length < 3) throw new AuthError("Username must be at least 3 characters.", "invalid_username");
        if (!/^[a-zA-Z0-9_.-]+$/.test(username)) throw new AuthError("Username may only contain letters, numbers, '.', '_', '-'.", "invalid_username");
        if (!ASSIGNABLE_ROLES.includes(role)) throw new AuthError("Invalid role.", "invalid_role");
        const pwErr = passwordPolicyError(password, username);
        if (pwErr) throw new AuthError(pwErr, "weak_password");

        const accounts = readAccounts();
        if (accounts.some((a) => a.username.toLowerCase() === username.toLowerCase())) {
            throw new AuthError("A user with that username already exists.", "duplicate_username");
        }

        const account = hashAccount(username, password, { role, isPrimaryOwner: false, createdBy: createdBy || null });
        writeAccounts([...accounts, account]);
        return sanitize(account);
    }

    /** Change an existing user's role. Cannot target or assign "owner". */
    function changeRole(targetUsername, newRole) {
        if (!ASSIGNABLE_ROLES.includes(newRole)) throw new AuthError("Invalid role.", "invalid_role");
        const accounts = readAccounts();
        const idx = accounts.findIndex((a) => a.username === targetUsername);
        if (idx === -1) throw new AuthError("User not found.", "not_found");
        assertCanModifyTarget(accounts[idx]);
        accounts[idx] = { ...accounts[idx], role: newRole };
        writeAccounts(accounts);
        return sanitize(accounts[idx]);
    }

    /** Enable or disable a user's ability to log in. Cannot target the Primary Owner or yourself. */
    function setDisabled(targetUsername, disabled, actingUsername) {
        const accounts = readAccounts();
        const idx = accounts.findIndex((a) => a.username === targetUsername);
        if (idx === -1) throw new AuthError("User not found.", "not_found");
        assertCanModifyTarget(accounts[idx]);
        if (targetUsername === actingUsername && disabled) {
            throw new AuthError("You cannot disable your own account.", "cannot_self_disable");
        }
        accounts[idx] = { ...accounts[idx], disabled: Boolean(disabled) };
        writeAccounts(accounts);
        return sanitize(accounts[idx]);
    }

    /** Deletes a user permanently. Cannot target the Primary Owner or yourself. */
    function deleteUser(targetUsername, actingUsername) {
        const accounts = readAccounts();
        const target = accounts.find((a) => a.username === targetUsername);
        if (!target) throw new AuthError("User not found.", "not_found");
        assertCanModifyTarget(target);
        if (targetUsername === actingUsername) {
            throw new AuthError("You cannot delete your own account.", "cannot_self_delete");
        }
        writeAccounts(accounts.filter((a) => a.username !== targetUsername));
        return true;
    }

    /** Self-service password change - requires knowing the current password. */
    function changeOwnPassword(username, currentPassword, newPassword) {
        const matched = verify(username, currentPassword);
        if (!matched) throw new AuthError("Current password is incorrect.", "wrong_password");
        const pwErr = passwordPolicyError(newPassword, username);
        if (pwErr) throw new AuthError(pwErr, "weak_password");

        const accounts = readAccounts();
        const idx = accounts.findIndex((a) => a.username === username);
        if (idx === -1) throw new AuthError("User not found.", "not_found");
        const salt = crypto.randomBytes(16).toString("hex");
        accounts[idx] = {
            ...accounts[idx],
            salt,
            hash: scryptHash(newPassword, salt),
            passwordChangedAt: new Date().toISOString(),
        };
        writeAccounts(accounts);
        return sanitize(accounts[idx]);
    }

    /**
     * Admin-initiated password reset - does NOT require the target's
     * current password, but does require USERS_MANAGE permission
     * (enforced by the caller in server.js) and cannot target the
     * Primary Owner (who must always reset their own password via
     * changeOwnPassword / the Account page).
     */
    function resetPassword(targetUsername, newPassword) {
        const accounts = readAccounts();
        const idx = accounts.findIndex((a) => a.username === targetUsername);
        if (idx === -1) throw new AuthError("User not found.", "not_found");
        assertCanModifyTarget(accounts[idx]);
        const pwErr = passwordPolicyError(newPassword, targetUsername);
        if (pwErr) throw new AuthError(pwErr, "weak_password");

        const salt = crypto.randomBytes(16).toString("hex");
        accounts[idx] = {
            ...accounts[idx],
            salt,
            hash: scryptHash(newPassword, salt),
            passwordChangedAt: new Date().toISOString(),
        };
        writeAccounts(accounts);
        return sanitize(accounts[idx]);
    }

    /**
     * Public self-registration (Stage 11 follow-up): anyone who can reach
     * the login page can create an account, but it always lands with
     * role="pending" and ZERO permissions - it is functionally inert
     * until a Primary Owner/Admin assigns it a real role from the User
     * Management page. This deliberately does not go through
     * createUser()'s ASSIGNABLE_ROLES check (an unauthenticated caller
     * could never pass USERS_MANAGE anyway) - it always forces "pending".
     */
    function registerPendingUser({ username, password }) {
        username = String(username || "").trim();
        if (!username || username.length < 3) throw new AuthError("Username must be at least 3 characters.", "invalid_username");
        if (!/^[a-zA-Z0-9_.-]+$/.test(username)) throw new AuthError("Username may only contain letters, numbers, '.', '_', '-'.", "invalid_username");
        const pwErr = passwordPolicyError(password, username);
        if (pwErr) throw new AuthError(pwErr, "weak_password");

        const accounts = readAccounts();
        if (accounts.some((a) => a.username.toLowerCase() === username.toLowerCase())) {
            throw new AuthError("A user with that username already exists.", "duplicate_username");
        }

        const account = hashAccount(username, password, { role: ROLES.PENDING, isPrimaryOwner: false, createdBy: "self-registration" });
        writeAccounts([...accounts, account]);
        return sanitize(account);
    }

    return {
        ensureAccounts,
        verify,
        readAccounts,
        getUser,
        listUsers,
        recordLogin,
        createUser,
        registerPendingUser,
        changeRole,
        setDisabled,
        deleteUser,
        changeOwnPassword,
        resetPassword,
    };
}
