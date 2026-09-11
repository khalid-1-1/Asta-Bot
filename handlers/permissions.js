import developer from "./developer.js";
import elitePro from "./elite-pro.js";
import ownerPro from "./owner-pro.js";

export const LEVELS = Object.freeze({
    USER: 0,
    ELITE: 1,
    OWNER: 2,
    DEVELOPER: 3,
});

export function normalize(id) {
    return developer.normalize(id);
}

export function isDeveloper({ pn, lid } = {}) {
    return developer.isDeveloper({ pn, lid });
}


export function isHardcodedOwner({ pn, lid } = {}) {
    return isDeveloper({ pn, lid });
}


export function isOwner({ pn, lid } = {}) {
    return isDeveloper({ pn, lid }) || ownerPro.isOwner({ pn, lid });
}


export function getOwners() {
    return ownerPro.getOwners();
}


export async function addOwner({ sock, ids } = {}) {
    return ownerPro.addOwner({ sock, ids });
}


export async function rmOwner({ sock, ids } = {}) {
    return ownerPro.rmOwner({ sock, ids });
}


export async function ownerReset() {
    return ownerPro.ownerReset();
}


export async function isElite({ sock, id } = {}) {
    if (!id) return false;
    try {
        
        if (sock && typeof sock.isElite === "function") {
            return await sock.isElite({ sock, id });
        }
        return await elitePro.isElite({ sock, id });
    } catch (e) {
        return false;
    }
}


export function hasFullAccess({ isHardcodedOwner: hardcodedOwnerFlag = false, isOwner: ownerFlag = false } = {}) {
    return Boolean(hardcodedOwnerFlag || ownerFlag);
}


export function isHardcodedBypassJid(jid) {
    return developer.getDeveloperNumbers().includes(normalize(jid));
}


export function resolveSenderRole({ fromMe, isOwner: ownerFlag, isHardcodedOwner: hardcodedOwnerFlag } = {}) {
    if (fromMe) return "BOT";
    if (hardcodedOwnerFlag) return "DEVELOPER";
    if (ownerFlag) return "OWNER";
    return "USER";
}


export function resolveSenderLevel({ isHardcodedOwner: hardcodedOwnerFlag, isOwner: ownerFlag, isElite: eliteFlag } = {}) {
    if (hardcodedOwnerFlag) return LEVELS.DEVELOPER;
    if (ownerFlag) return LEVELS.OWNER;
    if (eliteFlag) return LEVELS.ELITE;
    return LEVELS.USER;
}

function levelFromName(name) {
    if (!name) return null;
    const key = String(name)
        .trim()
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2") 
        .replace(/[-\s]+/g, "_")                
        .toUpperCase();
    return Object.prototype.hasOwnProperty.call(LEVELS, key) ? LEVELS[key] : null;
}


export function isProtectedTarget(rawId) {
    if (!rawId) return false;
    const id = String(rawId);
    const ctx = id.endsWith("@lid") ? { lid: id } : { pn: id };
    return isDeveloper(ctx) || isOwner(ctx);
}


export function splitProtectedTargets(ids = []) {
    const list = ids || [];
    const protectedIds = list.filter((id) => isProtectedTarget(id));
    const allowedIds = list.filter((id) => !isProtectedTarget(id));
    return { allowed: allowedIds, protected: protectedIds };
}


export function filterProtectedTargets(ids = []) {
    return splitProtectedTargets(ids).allowed;
}


export function getProtectedTargets(ids = []) {
    return splitProtectedTargets(ids).protected;
}


export function canExecute(handler, ctx = {}) {
    const {
        isOwner: ownerFlag = false,
        isHardcodedOwner: hardcodedOwnerFlag = false,
        isElite: eliteFlag = false,
        isBypass = false,
    } = ctx;

    if (handler?.dev === "on") {
        return hardcodedOwnerFlag
            ? { allowed: true, reason: "dev_only_developer" }
            : { allowed: false, reason: "dev_only_required" };
    }

    if (isBypass) return { allowed: true, reason: "hardcoded_bypass" };

    const requiredLevel = levelFromName(handler?.requiredLevel);

    if (requiredLevel !== null) {
        const senderLevel = resolveSenderLevel({ isHardcodedOwner: hardcodedOwnerFlag, isOwner: ownerFlag, isElite: eliteFlag });
        return senderLevel >= requiredLevel
            ? { allowed: true, reason: "required_level_met" }
            : { allowed: false, reason: "required_level_not_met" };
    }

    if (handler?.elite === "on") {
        if (eliteFlag || ownerFlag || hardcodedOwnerFlag) return { allowed: true, reason: "elite_or_above" };
        return { allowed: false, reason: "elite_required" };
    }

    return { allowed: true, reason: "no_restriction" };
}

export async function denyExecution({ sock, chatId, msg, reason, notify = false } = {}) {
    if (notify && sock && chatId) {
        try {
            await sock.sendMessage(chatId, { text: "🚫 غير مصرح لك بتنفيذ هذا الأمر." }, { quoted: msg });
        } catch (e) {
            
        }
    }
    return { allowed: false, reason };
}

const permissions = {
    LEVELS,
    normalize,
    isDeveloper,
    isHardcodedOwner,
    isOwner,
    getOwners,
    addOwner,
    rmOwner,
    ownerReset,
    isElite,
    hasFullAccess,
    isHardcodedBypassJid,
    resolveSenderRole,
    resolveSenderLevel,
    isProtectedTarget,
    splitProtectedTargets,
    filterProtectedTargets,
    getProtectedTargets,
    canExecute,
    denyExecution,
};

export default permissions;
