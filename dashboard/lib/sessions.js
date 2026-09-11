/**
 * dashboard/lib/sessions.js
 * -----------------------------------------------------------------------
 * Minimal, dependency-free session store.
 *
 * - Session ids are 256-bit random tokens (crypto.randomBytes), never
 *   guessable/sequential. The raw session id is ONLY ever placed in the
 *   HttpOnly cookie - it is never returned in any JSON API response, so
 *   an XSS bug or a stray log line can't hand out something that could
 *   authenticate as the user. Instead, each session also gets an
 *   independent, unguessable `publicId`, which is what "Active Sessions"
 *   listings and revoke-by-id calls use (Stage 11 #14 / Stage 12 #6).
 * - Sessions live in memory only (cleared on restart - acceptable for a
 *   Dashboard control panel; documented in the final report).
 * - The cookie is HttpOnly + SameSite=Strict (+ Secure when the request
 *   arrived over TLS) so it is not readable from JS and is not sent on
 *   cross-site requests.
 */

import crypto from "crypto";

const COOKIE_NAME = "asta_dashboard_sid";

export function createSessionStore(ttlMs) {
    const sessions = new Map(); // sid -> { username, expiresAt, csrfToken, publicId, createdAt, lastSeenAt, ip, userAgent }

    function cleanup() {
        const now = Date.now();
        for (const [sid, s] of sessions) {
            if (s.expiresAt <= now) sessions.delete(sid);
        }
    }
    const cleanupTimer = setInterval(cleanup, 60 * 1000);
    if (cleanupTimer.unref) cleanupTimer.unref();

    function create(username, meta = {}) {
        const sid = crypto.randomBytes(32).toString("hex");
        const csrfToken = crypto.randomBytes(32).toString("hex");
        const now = Date.now();
        sessions.set(sid, {
            username,
            expiresAt: now + ttlMs,
            csrfToken,
            publicId: crypto.randomBytes(12).toString("hex"),
            createdAt: new Date(now).toISOString(),
            lastSeenAt: new Date(now).toISOString(),
            ip: meta.ip || null,
            userAgent: meta.userAgent || null,
        });
        return sid;
    }

    function get(sid) {
        if (!sid) return null;
        const s = sessions.get(sid);
        if (!s) return null;
        if (s.expiresAt <= Date.now()) {
            sessions.delete(sid);
            return null;
        }
        // Sliding expiry on access.
        s.expiresAt = Date.now() + ttlMs;
        s.lastSeenAt = new Date().toISOString();
        return s;
    }

    function destroy(sid) {
        sessions.delete(sid);
    }

    /** All active sessions for a user, newest first - never exposes the raw sid. */
    function listForUser(username, currentSid) {
        const out = [];
        for (const [sid, s] of sessions) {
            if (s.username !== username) continue;
            if (s.expiresAt <= Date.now()) continue;
            out.push({
                id: s.publicId,
                createdAt: s.createdAt,
                lastSeenAt: s.lastSeenAt,
                expiresAt: new Date(s.expiresAt).toISOString(),
                ip: s.ip,
                userAgent: s.userAgent,
                current: sid === currentSid,
            });
        }
        return out.sort((a, b) => new Date(b.lastSeenAt) - new Date(a.lastSeenAt));
    }

    /** Revokes one session belonging to `username`, identified by its publicId. Returns true if revoked. */
    function revokeByPublicId(username, publicId) {
        for (const [sid, s] of sessions) {
            if (s.username === username && s.publicId === publicId) {
                sessions.delete(sid);
                return true;
            }
        }
        return false;
    }

    /** Revokes every session for a user, optionally keeping `exceptSid` alive (e.g. the session that just changed the password). */
    function destroyAllForUser(username, exceptSid = null) {
        let count = 0;
        for (const [sid, s] of sessions) {
            if (s.username === username && sid !== exceptSid) {
                sessions.delete(sid);
                count += 1;
            }
        }
        return count;
    }

    function stop() {
        clearInterval(cleanupTimer);
        sessions.clear();
    }

    return { create, get, destroy, listForUser, revokeByPublicId, destroyAllForUser, stop };
}

export function parseCookies(header) {
    const out = {};
    if (!header) return out;
    for (const part of header.split(";")) {
        const idx = part.indexOf("=");
        if (idx === -1) continue;
        const key = part.slice(0, idx).trim();
        const val = part.slice(idx + 1).trim();
        if (key) out[key] = decodeURIComponent(val);
    }
    return out;
}

export function sessionCookieName() {
    return COOKIE_NAME;
}

export function buildSessionCookie(sid, { secure }) {
    const parts = [
        `${COOKIE_NAME}=${sid}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Strict",
        `Max-Age=${60 * 60 * 24}`, // hard cap; server-side TTL is the real limit
    ];
    if (secure) parts.push("Secure");
    return parts.join("; ");
}

export function buildClearCookie({ secure }) {
    const parts = [
        `${COOKIE_NAME}=`,
        "Path=/",
        "HttpOnly",
        "SameSite=Strict",
        "Max-Age=0",
    ];
    if (secure) parts.push("Secure");
    return parts.join("; ");
}
