/**
 * handlers/owner-pro.js
 * -----------------------------------------------------------------------
 * Dynamic Owner Manager ("اونر اضف / ازل / عرض / ضبط").
 *
 * This module is the single source of truth for *dynamic* Owners - people
 * promoted at runtime via the "اونر" command. It intentionally mirrors the
 * shape of handlers/elite-pro.js (same jids/lids/twice persistence model,
 * same add/remove/reset function shapes) so it behaves predictably next to
 * the existing Elite system, and persists across restarts via
 * handlers/owner-pro.json (backed by the same "jsonion" db already used by
 * elite-pro.js and sub-owner.js).
 *
 * IMPORTANT - this file does NOT know or care about the *hardcoded*
 * Owner/Developer accounts. Those remain exclusively defined in
 * handlers/developer.js and are never read, written, or duplicated here.
 * handlers/permissions.js is what merges "hardcoded" (developer.js) with
 * "dynamic" (this file) into a single isOwner() answer - see the
 * integration there. This file only ever manages the dynamic list.
 */

import chalk from "chalk";
import { db } from "jsonion";
import developer from "./developer.js";

const OWNER_DB_PATH = "handlers/owner-pro.json";

function normalize(id) {
  return developer.normalize(id);
}

/**
 * Add one or more raw WhatsApp ids (jid or lid form) as dynamic Owners.
 * Mirrors handlers/elite-pro.js#addElite exactly (same result shape),
 * just against the Owner store instead of the Elite store.
 */
async function addOwner({ sock, ids }) {
  const ownerDB = new db(OWNER_DB_PATH);
  let result = { fail: [], success: [] };
  if (!ids || !sock)
    return console.log(chalk.red("should input ids or add sock"));

  for (const id of ids) {
    const is = {
      lid: id.endsWith("@lid"),
      jid: id.endsWith("@s.whatsapp.net"),
    };

    switch (true) {
      case is.lid: {
        const lids = ownerDB.get("lids") || [];
        if (lids.includes(id)) {
          result.fail.push({
            id,
            type: "lid",
            error: "exist_already",
            success: false,
            action: "add",
          });
          continue;
        }
        ownerDB.pushToPath("lids", id);
        result.success.push({
          id,
          type: "lid",
          error: null,
          success: true,
          action: "add",
        });
        break;
      }
      case is.jid: {
        const jids = ownerDB.get("jids") || [];
        if (jids.includes(id)) {
          result.fail.push({
            id,
            type: "jid",
            error: "exist_already",
            success: false,
            action: "add",
          });
          continue;
        }
        const [info] = await sock.onWhatsApp(id);
        if (!info) {
          result.fail.push({
            id,
            type: "jid",
            error: "not_on_whatsapp",
            success: false,
            action: "add",
          });
          continue;
        }
        ownerDB.pushToPath("jids", id);

        if (info.lid && !(ownerDB.get("lids") || []).includes(info.lid))
          ownerDB.pushToPath("lids", info.lid);

        const twice = ownerDB.get("twice") || {};
        if (info.lid) {
          ownerDB.set("twice", {
            ...twice,
            [info.lid]: info.jid,
            [info.jid]: info.lid,
          });
        }
        result.success.push({
          id,
          type: "jid",
          error: null,
          success: true,
          action: "add",
        });
        break;
      }
      default:
        continue;
    }
  }
  return result;
}

/**
 * Remove one or more raw WhatsApp ids (jid or lid form) from the dynamic
 * Owner list. Mirrors handlers/elite-pro.js#rmElite exactly.
 */
async function rmOwner({ sock, ids }) {
  const ownerDB = new db(OWNER_DB_PATH);
  let result = { fail: [], success: [] };
  if (!ids || !sock)
    return console.log(chalk.red("should input ids or add sock"));

  for (const id of ids) {
    const is = {
      lid: id.endsWith("@lid"),
      jid: id.endsWith("@s.whatsapp.net"),
    };

    switch (true) {
      case is.lid: {
        const lids = ownerDB.get("lids") || [];
        if (!lids.includes(id)) {
          result.fail.push({
            id,
            type: "lid",
            error: "not_exist",
            success: false,
            action: "remove",
          });
          continue;
        }
        const twice1 = ownerDB.get("twice") || {};
        const jids1 = ownerDB.get("jids") || [];
        ownerDB.set(
          "lids",
          lids.filter((l) => l !== id)
        );
        if (twice1[id]) {
          ownerDB.set(
            "jids",
            jids1.filter((j) => j !== twice1[id])
          );
          delete twice1[twice1[id]];
          delete twice1[id];
          ownerDB.set("twice", twice1);
        }
        result.success.push({
          id,
          type: "lid",
          error: null,
          success: true,
          action: "remove",
        });
        break;
      }
      case is.jid: {
        const [info] = await sock.onWhatsApp(id);
        const jids = ownerDB.get("jids") || [];
        const lids1 = ownerDB.get("lids") || [];
        const twice = ownerDB.get("twice") || {};
        const infoLid = info?.lid;

        if (!jids.includes(id) && !(infoLid && lids1.includes(infoLid))) {
          result.fail.push({
            id,
            type: "jid",
            error: "not_exist",
            success: false,
            action: "remove",
          });
          continue;
        }
        if (jids.includes(id))
          ownerDB.set(
            "jids",
            jids.filter((j) => j !== id)
          );
        if (infoLid && lids1.includes(infoLid))
          ownerDB.set(
            "lids",
            lids1.filter((l) => l !== infoLid)
          );

        if (twice[id]) delete twice[id];
        if (infoLid && twice[infoLid]) delete twice[infoLid];
        ownerDB.set("twice", twice);

        result.success.push({
          id,
          type: "jid",
          error: null,
          success: true,
          action: "remove",
        });
        break;
      }
      default:
        continue;
    }
  }
  return result;
}

/**
 * Async check by raw id (jid or lid), resolving jid<->lid via
 * sock.onWhatsApp when needed - the same pattern as elite-pro.js#isElite.
 * Used by the "اونر" plugin itself when checking "already an Owner?" for
 * a freshly-mentioned/replied/typed-number id.
 */
async function isOwnerId({ sock, id }) {
  if (!id) return false;
  const ownerDB = new db(OWNER_DB_PATH);
  const is = {
    lid: id.endsWith("@lid"),
    jid: id.endsWith("@s.whatsapp.net"),
  };

  const jids = ownerDB.get("jids") || [];
  const lids = ownerDB.get("lids") || [];

  if (is.jid) {
    if (jids.includes(id)) return true;
    try {
      const [info] = await sock.onWhatsApp(id);
      if (info?.lid && lids.includes(info.lid)) return true;
    } catch (e) {
      // ignore resolution failure, fall through to false
    }
    return false;
  }
  if (is.lid) {
    return lids.includes(id);
  }
  return false;
}

/**
 * Synchronous check against (pn, lid) - the shape every other role check
 * in handlers/permissions.js already uses (isDeveloper, isOwner).
 * This is what permissions.js#isOwner calls; it must stay synchronous
 * since isOwner() is resolved once per incoming message, before any
 * `handler.execute()` and without awaiting a sock round-trip.
 */
function isOwner({ pn, lid } = {}) {
  const ownerDB = new db(OWNER_DB_PATH);
  const jids = ownerDB.get("jids") || [];
  const lids = ownerDB.get("lids") || [];

  const pnPure = normalize(pn);
  const lidPure = normalize(lid);

  if (pnPure && jids.some((j) => normalize(j) === pnPure)) return true;
  if (lidPure && lids.some((l) => normalize(l) === lidPure)) return true;
  return false;
}

/**
 * Returns the list of dynamic Owners (lid form, same convention as
 * elite-pro.js#getElites) for display in "اونر عرض", or null if empty.
 */
function getOwners() {
  const ownerDB = new db(OWNER_DB_PATH);
  const lids = ownerDB.get("lids") || [];
  return lids.length > 0 ? lids : null;
}

/**
 * Clears every dynamic Owner. Never touches handlers/developer.js - the
 * hardcoded Owner/Developer accounts are not stored here and cannot be
 * affected by this call.
 */
async function ownerReset() {
  const ownerDB = new db(OWNER_DB_PATH);
  ownerDB.set("jids", []);
  ownerDB.set("lids", []);
  ownerDB.set("twice", {});
  return true;
}

const ownerPro = { addOwner, rmOwner, isOwner, isOwnerId, getOwners, ownerReset };
export default ownerPro;
