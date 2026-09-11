/**
 * dashboard/lib/roles.js
 * -----------------------------------------------------------------------
 * Stage 11 - Multi-User Dashboard & Role-Based Access Control.
 *
 * This is the Dashboard's OWN role/permission system. It has nothing to
 * do with, and never touches, the WhatsApp bot's Owner/Sub-Owner/Elite
 * permission system (handlers/permissions.js, accounts/*). That system
 * decides who can run bot *commands* inside WhatsApp chats. This system
 * decides who can log into and use the web Dashboard, and what parts of
 * it they can see or act on. Keeping them in separate files, with
 * separate data stores and separate vocabulary (Dashboard "roles" vs bot
 * "levels"), is deliberate so the two are never confused or merged.
 *
 * Four Dashboard roles, from most to least privileged:
 *   - owner   : the single Primary Owner / Super Admin account created at
 *               first boot. Full access to everything, and the only
 *               account nobody else can delete, disable, demote, or
 *               otherwise touch (see auth-store.js for the actual
 *               enforcement of that protection).
 *   - admin   : essentially full operational access (same permission set
 *               as owner) EXCEPT it can never modify, disable, delete, or
 *               reassign the Primary Owner account, and can never create
 *               or promote anyone else to the "owner" role.
 *   - manager : day-to-day operational role - statistics, logs, plugin
 *               view/enable/disable/reload, alerts - but no destructive
 *               "Bot Control" (restart), no settings, no backups, no
 *               scheduler, no user management, no audit log.
 *   - viewer  : read-only. Dashboard overview + statistics only.
 *
 * Every permission listed here is enforced on the BACKEND (server.js
 * wraps every sensitive route with requirePermission()) - the frontend
 * (public/app.js + each page) only uses this same permission list to
 * decide what to *show*, which is a convenience, not the security
 * boundary. See server.js's requirePermission() for the actual gate.
 */

export const ROLES = Object.freeze({
    OWNER: "owner",
    ADMIN: "admin",
    MANAGER: "manager",
    VIEWER: "viewer",
    // Stage 11 follow-up - accounts created through the public, no-login-
    // required "Create Account" link on the login page land in this role.
    // It carries ZERO permissions (see ROLE_PERMISSIONS below) - a pending
    // account can log in and see its own Account page, and nothing else,
    // until a Primary Owner/Admin picks a real role for it from the User
    // Management page. This is what "الاكونتات الي تتعمل من برة ماعندهاش
    // رتبة" means in practice: no dashboard capability until approved.
    PENDING: "pending",
});

export const ALL_ROLES = Object.freeze([ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.VIEWER, ROLES.PENDING]);

// Roles that may be assigned to a *new or existing* dashboard user via the
// User Management UI/API. "owner" is deliberately excluded - it is not an
// assignable role. It belongs to exactly one account (the Primary Owner),
// set once at bootstrap, and can never be granted to anyone else -
// including by another owner-equivalent admin. This is what keeps the
// Primary Owner singleton truly singleton.
export const ASSIGNABLE_ROLES = Object.freeze([ROLES.ADMIN, ROLES.MANAGER, ROLES.VIEWER]);

export const PERM = Object.freeze({
    USERS_MANAGE: "users.manage",
    BOT_CONTROL: "bot.control",
    PLUGINS_VIEW: "plugins.view",
    PLUGINS_MANAGE: "plugins.manage",
    LOGS_VIEW: "logs.view",
    STATS_VIEW: "stats.view",
    ALERTS_VIEW: "alerts.view",
    SETTINGS_VIEW: "settings.view",
    SETTINGS_MANAGE: "settings.manage",
    AUDIT_VIEW: "audit.view",
    SCHEDULER_MANAGE: "scheduler.manage",
    BACKUPS_MANAGE: "backups.manage",
});

const ALL_PERMS = Object.values(PERM);

// Owner and Admin deliberately share the exact same permission set - the
// difference between them is NOT which buttons they can see, it's that
// the backend additionally refuses to let an "admin" touch the Primary
// Owner account (see auth-store.js: assertCanModifyTarget). That keeps
// "most admin permissions, minus primary-account tampering" (the Stage 11
// spec for the Admin role) as an account-level rule instead of a
// duplicated, driftable permission list.
const ROLE_PERMISSIONS = Object.freeze({
    [ROLES.OWNER]: ALL_PERMS,
    [ROLES.ADMIN]: ALL_PERMS,
    [ROLES.MANAGER]: [
        PERM.STATS_VIEW,
        PERM.PLUGINS_VIEW,
        PERM.PLUGINS_MANAGE,
        PERM.LOGS_VIEW,
        PERM.ALERTS_VIEW,
    ],
    [ROLES.VIEWER]: [PERM.STATS_VIEW],
    [ROLES.PENDING]: [],
});

export function isValidRole(role) {
    return ALL_ROLES.includes(role);
}

export function permissionsForRole(role) {
    return ROLE_PERMISSIONS[role] || [];
}

export function roleHasPermission(role, permission) {
    return permissionsForRole(role).includes(permission);
}

/** Human-readable label, used only for display - never for auth decisions. */
export function roleLabel(role) {
    switch (role) {
        case ROLES.OWNER: return "Primary Owner";
        case ROLES.ADMIN: return "Admin";
        case ROLES.MANAGER: return "Manager";
        case ROLES.VIEWER: return "Viewer";
        case ROLES.PENDING: return "Pending Approval";
        default: return role || "unknown";
    }
}
