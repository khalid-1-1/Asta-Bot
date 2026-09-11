import fs from "fs-extra";
import path from "path";
import { pathToFileURL, fileURLToPath } from "url";
import chalk from "chalk"; 
import axios from "axios";
import { pipeline } from "stream/promises";
import * as pluginState from "./pluginState.js"; // Stage 8, item #4 - additive enable/disable + error tracking
const colors = {
  blue: "\x1b[34m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  reset: "\x1b[0m"
};

const logger = {
  info: (...args) => console.log(colors.blue, ...args, colors.reset),
  success: (...args) => console.log(colors.green, ...args, colors.reset),
  warn: (...args) => console.log(colors.yellow, ...args, colors.reset),
  error: (...args) => console.log(colors.red, ...args, colors.reset)
};

let loadedPlugins = {};
let pluginIssues = [];

export function getPluginIssues() {
  return pluginIssues;
}

// ---------------------------------------------------------------------------
// Plugin Metadata (Stage 3, additive only)
// -----------------------------------------------------------------------
// Everything in this section is purely additive on top of the loader that
// already existed: old plugins that only ever set { command, elite, lock,
// group, prv } keep working exactly as before. Nothing here is mandatory —
// a plugin that doesn't set category/description/usage/requiredLevel/
// cooldown simply falls back to a sensible default and loads normally.
// requiredLevel itself is consumed by handlers/permissions.js (canExecute) -
// this file never decides who is allowed to run a command, it only makes
// sure the field is well-formed before permissions.js sees it.
// ---------------------------------------------------------------------------

// Mirrors handlers/permissions.js LEVELS keys so a bad/misspelled
// requiredLevel can be caught here and reported via "مشاكل" instead of
// silently being ignored deep inside permissions.js.
const KNOWN_LEVEL_NAMES = new Set(["user", "elite", "owner", "developer"]);

function normalizeLevelName(name) {
  return String(name).trim().toLowerCase().replace(/[-\s]/g, "");
}

/**
 * Validates the *new* optional metadata fields on an already-resolved
 * handler. Never touches/validates the legacy fields (command, elite,
 * lock, group, prv) - those keep behaving exactly as they always have,
 * in messages.js and permissions.js. Anything invalid here is stripped
 * (not fatal) and reported as a warning, so a typo in a new field can
 * never break a plugin that used to work.
 *
 * Returns an array of warning strings (empty if everything is fine).
 */
function validatePluginMetadata(handler) {
  const warnings = [];

  if (handler.category !== undefined && typeof handler.category !== "string") {
    warnings.push(`category يجب أن يكون نصًا (string) - تم تجاهله`);
    delete handler.category;
  }

  if (handler.description !== undefined && typeof handler.description !== "string") {
    warnings.push(`description يجب أن يكون نصًا (string) - تم تجاهله`);
    delete handler.description;
  }

  if (handler.usage !== undefined && typeof handler.usage !== "string") {
    warnings.push(`usage يجب أن يكون نصًا (string) - تم تجاهله`);
    delete handler.usage;
  }

  if (handler.requiredLevel !== undefined) {
    if (!KNOWN_LEVEL_NAMES.has(normalizeLevelName(handler.requiredLevel))) {
      warnings.push(`requiredLevel غير معروف: "${handler.requiredLevel}" - تم تجاهله`);
      delete handler.requiredLevel;
    }
  }

  if (handler.cooldown !== undefined) {
    const n = Number(handler.cooldown);
    if (!Number.isFinite(n) || n < 0) {
      warnings.push(`cooldown يجب أن يكون رقمًا غير سالب (بالميلي ثانية) - تم تجاهله`);
      delete handler.cooldown;
    } else {
      handler.cooldown = n; // normalize e.g. "5000" -> 5000
    }
  }

  return warnings;
}

/**
 * Category derivation (item #3 of the request): if the plugin didn't
 * declare its own `category`, fall back to the name of the immediate
 * parent folder under plugins/ - exactly the same rule menu.js already
 * applies ad-hoc when it groups commands by folder, just centralized
 * here so every consumer (not only menu.js) can rely on handler.category.
 */
function deriveCategoryFromPath(filePath, pluginsDir) {
  const rel = path.relative(pluginsDir, filePath);
  const parts = rel.split(path.sep);
  return parts.length > 1 ? parts[0] : "عام";
}

async function getAllJsFiles(dir) {
  let results = [];
  
  if (!await fs.pathExists(dir)) return results;

  const list = await fs.readdir(dir, { withFileTypes: true });

  for (const item of list) {
    const fullPath = path.join(dir, item.name);

    if (item.isDirectory()) {
      const subFiles = await getAllJsFiles(fullPath);
      results = results.concat(subFiles);
    } else if (item.isFile() && item.name.endsWith(".js")) {
      results.push(fullPath);
    }
  }
  return results;
}



// `targetPlugins`/`issues` are the in-progress reload buffers passed in by
// loadPlugins() (see note there on why loading happens off to the side
// instead of directly into the live `loadedPlugins`/`pluginIssues`).
async function loadSinglePlugin(filePath, themeHex, pluginsDir, targetPlugins, issues) {
  try {
    const fileUrl = pathToFileURL(filePath).href + `?update=${Date.now()}`;
    const module = await import(fileUrl);

    let handler = null;

    if (module.default && module.default.AstaPlugin && typeof module.default.execute === "function") {
      handler = { ...module.default.AstaPlugin, execute: module.default.execute };
    } else if (module.default && typeof module.default.execute === "function") {
      handler = module.default;
    } else if (module.AstaPlugin && typeof module.execute === "function") {
      handler = { ...module.AstaPlugin, execute: module.execute };
    } else if (typeof module.execute === "function") {
      handler = module;
    }

    if (!handler || !handler.execute) {
      logger.warn(`⚠ Skipped (no execute): ${filePath}`);
      issues.push(`❌ Skipped: ${filePath}`);
      return;
    }

    handler.filePath = filePath;
    // Stage 8, item #4: stable per-file id, independent of which command(s)
    // this file registers - this is what the Dashboard enable/disable and
    // error-tracking APIs key off of.
    handler.pluginId = pluginState.toPluginId(filePath, pluginsDir);

    // --- New optional metadata: validated, never required (see above). ---
    const metaWarnings = validatePluginMetadata(handler);
    for (const w of metaWarnings) {
      logger.warn(`⚠ ${path.basename(filePath)}: ${w}`);
      issues.push(`⚠ ${path.basename(filePath)}: ${w}`);
    }
    if (!handler.category) {
      handler.category = deriveCategoryFromPath(filePath, pluginsDir);
    }

    let commands = handler.command;

    if (!commands) {
      const fileName = path.basename(filePath).replace(".js", "");
      commands = [fileName];
      logger.info(`ℹ '${fileName}' ⬇️  NAME FILE IS THE COMMAND HERE UNTIL YOU FIX IT`);
    } else if (typeof commands === "string") {
      commands = [commands];
    } else if (!Array.isArray(commands)) {
      logger.warn(`⚠ Invalid command format in ${filePath}`);
      issues.push(`❌ Invalid command format: ${filePath}`);
      return;
    }

    for (const cmd of commands) {
      if (typeof cmd !== "string") continue;

      const key = cmd.toLowerCase().trim();

      // Aliases already worked (command: [a, b]) - this only adds
      // visibility when two *different* plugin files claim the same
      // command/alias. Behavior is unchanged: the last one loaded still
      // wins, exactly as before; this just surfaces it via "مشاكل"
      // instead of failing silently.
      if (targetPlugins[key] && targetPlugins[key] !== handler) {
        const msg = `تعارض أمر "${key}" بين ${targetPlugins[key].filePath} و ${filePath} - سيتم استخدام الأخير`;
        logger.warn(`⚠ ${msg}`);
        issues.push(`⚠ ${msg}`);
      }

      targetPlugins[key] = handler;


      console.log(chalk.hex(themeHex)(`🛸 Plugin loaded: ${key}`));
    }

  } catch (err) {
    logger.error(`❌ Failed to load plugin (${filePath}):`, err);
    issues.push(
      `Plugin Error\nPlugin: ${path.basename(filePath)}\nError: ${err?.message || String(err)}`
    );
    // Stage 8, item #4: load failures count toward the plugin's error
    // history shown in the Dashboard, same as runtime failures do.
    try {
      pluginState.recordLoadError(pluginState.toPluginId(filePath, pluginsDir), err?.message || String(err));
    } catch (e) { /* tracking must never break the loader */ }
  }
}

/**
 * Best-effort resource cleanup for Hot Reload (item #7). Every reload
 * dynamically re-imports every plugin file with a cache-busting query
 * string, so the *objects* in `oldPlugins` are always genuinely replaced
 * by fresh ones in `newPlugins` - never the same reference. If a plugin
 * exposes an optional `dispose()`/`onUnload()` function, this is the
 * "clean up listeners/timers" step from the request; plugins that don't
 * define one (i.e. almost all existing plugins today) are completely
 * unaffected.
 */
async function disposeOldPlugins(oldPlugins, newHandlerSet) {
  const oldHandlers = new Set(Object.values(oldPlugins || {}));

  for (const handler of oldHandlers) {
    if (!handler || newHandlerSet.has(handler)) continue;
    const cleanup = handler.dispose || handler.onUnload;
    if (typeof cleanup === "function") {
      try {
        await cleanup();
      } catch (e) {
        logger.warn(`⚠ Plugin cleanup (dispose) failed for ${handler.filePath}:`, e?.message || e);
      }
    }
  }
}

export async function loadPlugins(themeColor) {
  let hexColor = themeColor || '#00FF00';
  if (!hexColor.startsWith('#')) hexColor = '#' + hexColor;

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const pluginsDir = path.join(__dirname, "../plugins");

  await fs.ensureDir(pluginsDir);

  const files = await getAllJsFiles(pluginsDir);

  // Load into local buffers first, and only swap them into the live
  // loadedPlugins/pluginIssues at the very end (item #7, "Hot Reload آمن").
  // Previously `loadedPlugins = {}` ran synchronously before any `await`,
  // so every command was unavailable for the entire duration of the
  // reload (and would stay empty forever if getAllJsFiles/ensureDir threw).
  // Buffering means: (a) in-flight commands keep resolving against the
  // still-live old plugin set while the reload is in progress, and (b) if
  // something throws before the loop finishes, the old, working plugin
  // set is left untouched instead of being wiped out.
  const newPlugins = {};
  const issues = [];

  for (const file of files) {
    await loadSinglePlugin(file, hexColor, pluginsDir, newPlugins, issues);
  }

  await disposeOldPlugins(loadedPlugins, new Set(Object.values(newPlugins)));

  loadedPlugins = newPlugins;
  pluginIssues = issues;
  pluginState.markReloaded(); // Stage 8, item #4 - "Last Reload" shown in the Dashboard

  console.log(chalk.hex(hexColor)("🔌 All plugins loaded successfully"));
  
  return loadedPlugins;
}

export function getPlugins() {
  return loadedPlugins;
}

// ---------------------------------------------------------------------------
// Stage 8, item #4 (Advanced Plugin Management) - thin, additive wrappers
// around handlers/pluginState.js so messages.js and dashboard/server.js
// never need to import that module's internals directly.
// ---------------------------------------------------------------------------

/** True if the handler behind `command` is currently disabled. */
export function isCommandDisabled(command) {
  const handler = loadedPlugins[String(command).toLowerCase().trim()];
  if (!handler?.pluginId) return false;
  return pluginState.isDisabled(handler.pluginId);
}

/** Record a runtime (execution) error against the plugin that owns `command`. */
export function recordCommandRuntimeError(command, message) {
  const handler = loadedPlugins[String(command).toLowerCase().trim()];
  if (!handler?.pluginId) return;
  pluginState.recordRuntimeError(handler.pluginId, message);
}

/**
 * Enable/disable a plugin by command name (any alias works - they all
 * resolve to the same file/pluginId). Returns { ok, reason }.
 */
export function setPluginEnabledByCommand(command, enabled, opts = {}) {
  const handler = loadedPlugins[String(command).toLowerCase().trim()];
  if (!handler?.pluginId) return { ok: false, reason: "unknown_plugin" };
  const commands = Array.isArray(handler.command) ? handler.command : handler.command ? [handler.command] : [command];
  return pluginState.setDisabled(handler.pluginId, !enabled, { commands, admin: opts.admin });
}

export function getPluginStateInfo(command) {
  const handler = loadedPlugins[String(command).toLowerCase().trim()];
  if (!handler?.pluginId) return null;
  return { pluginId: handler.pluginId, ...(pluginState.getEntry(handler.pluginId) || { disabled: false, lastError: null, errorCount: 0 }) };
}

export function getLastReloadTime() {
  return pluginState.getLastReload();
}

export function exportPluginState() {
  return pluginState.exportAll();
}

export function importPluginState(map) {
  return pluginState.importAll(map);
}

export const PROTECTED_PLUGIN_COMMANDS = pluginState.PROTECTED_COMMANDS;

/**
 * All currently-loaded plugins' error info, one entry per unique file
 * (Stage 8, item #3 - "Plugin يفشل عدة مرات" alert input).
 */
export function getAllPluginErrorCounts() {
  const seen = new Set();
  const out = [];
  for (const handler of Object.values(loadedPlugins)) {
    if (!handler?.pluginId || seen.has(handler.pluginId)) continue;
    seen.add(handler.pluginId);
    const entry = pluginState.getEntry(handler.pluginId);
    out.push({ pluginId: handler.pluginId, errorCount: entry?.errorCount || 0, lastError: entry?.lastError || null, disabled: Boolean(entry?.disabled) });
  }
  return out;
}
