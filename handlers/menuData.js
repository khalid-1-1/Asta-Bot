/**
 * handlers/menuData.js
 * -----------------------------------------------------------------------
 * Stage 4 — shared data layer for the Dynamic Menu + Help system.
 *
 * This module does NOT introduce a new permission system and does NOT
 * touch handlers/plugins.js or handlers/permissions.js. It only reads
 * from getPlugins() (handlers/plugins.js) and permissions.canExecute()
 * (handlers/permissions.js) and exposes small, named helpers so that both
 * plugins/<ادوات>/menu.js (the interactive "اوامر" menu) and the new
 * "مساعدة" help command can share exactly the same:
 *
 *   - de-duplication of aliases (same handler object under several keys)
 *   - category derivation (from handler.category, already guaranteed by
 *     the Plugin Loader — either author-set or derived from the folder)
 *   - permission-based visibility (canExecute(), never adminKeywords
 *     guessing — see the removed heuristic that used to live in menu.js)
 *   - hidden:true handling
 *
 * Nothing in this file changes plugin behavior, execution, or the
 * permission rules themselves — it only decides what is *shown*.
 */

import path from "path";
import { getPlugins } from "./plugins.js";
import permissions from "./permissions.js";

// ---------------------------------------------------------------------------
// Sender context
// ---------------------------------------------------------------------------

/**
 * Builds the same { isOwner, isHardcodedOwner, isElite, isBypass } shape
 * that handlers/messages.js already computes for permissions.canExecute()
 * right before calling handler.execute(). Menu/Help plugins receive `msg`
 * after messages.js has already attached msg.isOwner / msg.isHardcodedOwner
 * (see handleSingleMessage), so this simply reuses those instead of
 * resolving roles a second time. isElite still needs sock.isElite() (async,
 * may hit elite-pro.js), exactly like messages.js does. Permission model is
 * the flat USER < ELITE < OWNER < DEVELOPER hierarchy - there is no
 * Sub-Owner tier anymore.
 */
export async function resolveSenderContext({ sock, msg, sender } = {}) {
  const isOwner = Boolean(msg?.isOwner);
  const isHardcodedOwner = msg?.isHardcodedOwner !== undefined
    ? Boolean(msg.isHardcodedOwner)
    : permissions.isHardcodedOwner({ pn: sender?.pn, lid: sender?.lid });

  let isElite = false;
  try {
    isElite = Boolean(await sock.isElite({ sock, id: sender?.pn }));
  } catch (e) {
    isElite = false;
  }

  const isBypass = permissions.isHardcodedBypassJid(msg?.key?.remoteJid);

  return { isOwner, isHardcodedOwner, isElite, isBypass };
}

// ---------------------------------------------------------------------------
// Command name / alias helpers
// ---------------------------------------------------------------------------

/**
 * Returns the full list of command names/aliases declared on a handler,
 * in the exact order the plugin author wrote them. Mirrors the fallback
 * handlers/plugins.js itself uses (filename becomes the command) so the
 * displayed name always matches what actually triggers the plugin.
 */
export function commandNamesOf(handler) {
  if (!handler) return [];
  if (Array.isArray(handler.command)) {
    return handler.command.filter((c) => typeof c === "string" && c.trim().length > 0);
  }
  if (typeof handler.command === "string" && handler.command.trim().length > 0) {
    return [handler.command];
  }
  if (handler.filePath) {
    return [path.basename(handler.filePath).replace(/\.js$/i, "")];
  }
  return [];
}

export function primaryCommandOf(handler) {
  return commandNamesOf(handler)[0] || null;
}

export function aliasesOf(handler) {
  return commandNamesOf(handler).slice(1);
}

// ---------------------------------------------------------------------------
// De-duplication (item #10 / #2 — same Plugin must never appear twice just
// because it has aliases; loader assigns the exact same object reference
// under every alias key, so Set() dedup is safe and cheap).
// ---------------------------------------------------------------------------

export function getUniqueHandlers() {
  return Array.from(new Set(Object.values(getPlugins())));
}

// ---------------------------------------------------------------------------
// Visibility (permission + hidden). NEVER guesses from command name or
// description (item #6) — always defers to permissions.canExecute().
// ---------------------------------------------------------------------------

export function isVisibleTo(handler, ctx) {
  if (!handler || handler.hidden) return false;
  return permissions.canExecute(handler, ctx).allowed;
}

export function getVisibleHandlers(ctx) {
  return getUniqueHandlers().filter((h) => isVisibleTo(h, ctx));
}

// ---------------------------------------------------------------------------
// Categories — always derived from handler.category, never hardcoded
// (item #11). handlers/plugins.js guarantees every loaded handler has a
// non-empty .category (author-set or derived from its folder), so no
// extra fallback is needed here.
// ---------------------------------------------------------------------------

/**
 * All category names that have at least one non-hidden plugin, regardless
 * of the current viewer's permission level. This mirrors the previous
 * behavior of listing every plugins/<folder> - category *names* are not
 * treated as sensitive (a locked/elite category still shows up, it will
 * just contain zero visible commands for a viewer without access).
 * hidden:true plugins never contribute a category on their own.
 */
export function getAllCategoryNames() {
  const seen = [];
  for (const h of getUniqueHandlers()) {
    if (h.hidden) continue;
    if (!h.category) continue;
    if (!seen.includes(h.category)) seen.push(h.category);
  }
  return seen;
}

/** Categories that have >=1 command the given sender can actually see. */
export function getVisibleCategoryNames(ctx) {
  const seen = [];
  for (const h of getVisibleHandlers(ctx)) {
    if (!seen.includes(h.category)) seen.push(h.category);
  }
  return seen;
}

/** Case-insensitive category lookup against every known category name. */
export function findCategoryCaseInsensitive(name) {
  if (!name) return null;
  const target = String(name).trim().toLowerCase();
  return getAllCategoryNames().find((c) => c.toLowerCase() === target) || null;
}

/** Visible handlers belonging to one category, for one sender. */
export function getVisibleHandlersInCategory(categoryName, ctx) {
  return getVisibleHandlers(ctx).filter((h) => h.category === categoryName);
}

// ---------------------------------------------------------------------------
// Command lookup (for "مساعدة <command>"). Raw lookup only — callers must
// still run isVisibleTo() before showing anything, so a hidden/unauthorized
// command never leaks its existence.
// ---------------------------------------------------------------------------

export function findHandlerByCommand(name) {
  if (!name) return null;
  const key = String(name).toLowerCase().trim();
  return getPlugins()[key] || null;
}

// ---------------------------------------------------------------------------
// Display helpers — status badges + permission label. Driven only by real
// metadata (requiredLevel, legacy elite/lock flags), never by scanning
// command names or descriptions for "admin-looking" keywords.
// ---------------------------------------------------------------------------

function normalizeLevelName(name) {
  if (!name) return null;
  return String(name).trim().toLowerCase().replace(/[-\s]/g, "");
}

const LEVEL_LABELS = {
  user: "User",
  elite: "Elite",
  owner: "Owner",
  developer: "Developer",
};

// Permission model: USER < ELITE < OWNER < DEVELOPER (flat, no Sub-Owner
// tier). A handler shows exactly ONE badge - the highest permission it
// actually requires - never a stack of badges. Priority: 👑 > 🔒 > 🔰.
const BADGE_DEVELOPER = "👑"; // dev: "on", or requiredLevel: "developer"
const BADGE_OWNER = "🔒";     // lock: "on", or requiredLevel: "owner"
const BADGE_ELITE = "🔰";     // elite: "on", or requiredLevel: "elite"

/** The single highest-priority badge for a handler, or "" if unrestricted. */
function highestBadge(handler) {
  const levelKey = normalizeLevelName(handler?.requiredLevel);

  if (handler?.dev === "on" || levelKey === "developer") return BADGE_DEVELOPER;
  if (handler?.lock === "on" || levelKey === "owner") return BADGE_OWNER;
  if (handler?.elite === "on" || levelKey === "elite") return BADGE_ELITE;
  return "";
}

/** Small inline suffix shown next to a command name in menu listings. */
export function statusSuffix(handler) {
  const badge = highestBadge(handler);
  return badge ? ` ${badge}` : "";
}

/** Human-readable permission label for the Help card ("🛡 الصلاحية"). */
export function permissionLabel(handler) {
  const levelKey = normalizeLevelName(handler?.requiredLevel);
  if (levelKey && LEVEL_LABELS[levelKey]) return LEVEL_LABELS[levelKey];
  if (handler?.dev === "on") return "Developer";
  if (handler?.lock === "on") return "Owner";
  return handler?.elite === "on" ? "Elite" : "User";
}

/**
 * One menu-list entry for a handler, shared by the interactive "اوامر"
 * menu and "مساعدة <category>" so both stay visually identical:
 *   ✦ `command` [badges]
 *     ╰ description
 *     ╰ البدائل: alias1, alias2
 */
export function formatCommandLine(handler) {
  const primary = primaryCommandOf(handler);
  const aliases = aliasesOf(handler);
  const suffix = statusSuffix(handler);

  let line = `✦ \`${primary}\`${suffix}`;
  if (handler.description) line += `\n  ╰ ${handler.description}`;
  if (aliases.length > 0) line += `\n  ╰ البدائل: ${aliases.join(", ")}`;
  return line;
}

export default {
  resolveSenderContext,
  commandNamesOf,
  primaryCommandOf,
  aliasesOf,
  getUniqueHandlers,
  isVisibleTo,
  getVisibleHandlers,
  getAllCategoryNames,
  getVisibleCategoryNames,
  findCategoryCaseInsensitive,
  getVisibleHandlersInCategory,
  findHandlerByCommand,
  statusSuffix,
  permissionLabel,
  formatCommandLine,
};
