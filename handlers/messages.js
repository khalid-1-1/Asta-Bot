import { getPlugins, loadPlugins, getPluginIssues, isCommandDisabled, recordCommandRuntimeError } from "./plugins.js";
import * as telemetry from "./telemetry.js"; // Stage 7: additive stats/log hooks only
import configImport from "../asta/config.js";
import { playOK } from "../utils/sound.js";

const playError = () => {}; 

import elitePro from "./elite-pro.js";
import developer from "./developer.js";
import permissions from "./permissions.js";
import waUtils from "./waUtils.js";
import fs from "fs";
import axios from "axios";
import { pipeline } from "stream/promises";
import path from "path";
import chalk from "chalk";
import { DisconnectReason } from '@whiskeysockets/baileys';
import { fileURLToPath } from 'url';

let plugins = null;
const messageBuffer = [];
let sockGlobal;
let systemLoggerSock = null;
// Persistent across message batches (and reconnects) - tracks chats that currently
// have a pending password-lock prompt, so re-entrant commands are ignored while waiting.
const activeListeners = new Map();

// Stage 3, item #9 (Cooldown): purely optional, per-plugin. A plugin only
// gets rate-limited if it explicitly sets `cooldown` (ms) on its AstaPlugin
// export - see handlers/plugins.js for validation of that field. This is
// NOT applied to every command automatically, and it is intentionally a
// simple in-memory map (resets on restart) - a real Rate Limiting system
// is explicitly out of scope for this stage.
const cooldownState = new Map();

function cooldownKey(command, sender) {
    return `${command}::${sender?.pn || sender?.lid || "unknown"}`;
}

function checkCooldown(handler, command, sender) {
    const cooldownMs = Number(handler?.cooldown);
    if (!Number.isFinite(cooldownMs) || cooldownMs <= 0) return { onCooldown: false };

    const key = cooldownKey(command, sender);
    const last = cooldownState.get(key);
    const now = Date.now();

    if (last && (now - last) < cooldownMs) {
        return { onCooldown: true, remainingMs: cooldownMs - (now - last) };
    }
    return { onCooldown: false };
}

function markCooldown(handler, command, sender) {
    const cooldownMs = Number(handler?.cooldown);
    if (!Number.isFinite(cooldownMs) || cooldownMs <= 0) return;
    cooldownState.set(cooldownKey(command, sender), Date.now());
}

// Stage 5, item #12 (Maps Cleanup): cooldownState only ever grew - a
// timestamp was written on every cooldown-gated command but nothing ever
// removed it, so a long-running bot would accumulate one entry per
// (command, user) pair forever. This is a conservative sweep (not tied to
// any single plugin's cooldown value, since that isn't stored): anything
// idle for over an hour is almost certainly a stale, long-expired entry -
// real cooldowns in this codebase are seconds-to-minutes - so pruning at
// that age cannot affect an active cooldown.
const COOLDOWN_PRUNE_AGE_MS = 60 * 60 * 1000;
setInterval(() => {
    const now = Date.now();
    for (const [key, ts] of cooldownState) {
        if (now - ts > COOLDOWN_PRUNE_AGE_MS) cooldownState.delete(key);
    }
}, 10 * 60 * 1000);


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const configPath = path.join(process.cwd(), "asta", "config.js");


const dataDir = path.join(process.cwd(), "asta", "data");
const historyPath = path.join(dataDir, "History.txt");


const groupStatesPath = path.join(dataDir, "groupStates.json");


function getGroupStates() {
    try {
        if (!fs.existsSync(groupStatesPath)) {
            fs.writeFileSync(groupStatesPath, JSON.stringify({}));
        }
        return JSON.parse(fs.readFileSync(groupStatesPath, "utf8"));
    } catch (e) {
        return {};
    }
}


function saveGroupState(chatId, isActive) {
    const states = getGroupStates();
    states[chatId] = isActive;
    fs.writeFileSync(groupStatesPath, JSON.stringify(states, null, 2));
}


if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}


export function logToHistory(logData) {
    try {
        const timestamp = new Date().toLocaleString('en-US', { hour12: false });

        const entry = `\n[${timestamp}]\n${logData}\n`;
        fs.appendFileSync(historyPath, entry, "utf8");
    } catch (e) {

    }
}


const normalizeJid = (jid) => jid ? jid.split('@')[0].split(':')[0] : '';



function normalizeAccessMode(raw) {
    if (raw === "on") return "elite";     
    if (raw === "off") return "public";
    if (["public", "elite", "owner", "dev"].includes(raw)) return raw;
    return "public";
}

function getLiveSystemConfig() {
    try {
        const content = fs.readFileSync(configPath, "utf8");
        const prefixMatch = content.match(/let\s+prefix\s*=\s*['"](.*?)['"];/);
        const currentPrefix = prefixMatch ? prefixMatch[1] : configImport.prefix;
        const botMatch = content.match(/bot:\s*['"](on|off)['"]/);
        const modeMatch = content.match(/mode:\s*['"](on|off|public|elite|owner|dev)['"]/);
        const rawMode = modeMatch ? modeMatch[1] : "off";

        return {
            prefix: currentPrefix,
            botState: botMatch ? botMatch[1] : "on",
            modeState: rawMode, 
            accessMode: normalizeAccessMode(rawMode)
        };
    } catch (e) {
        return { prefix: configImport.prefix, botState: "on", modeState: "off", accessMode: "public" };
    }
}


function isAllowedByAccessMode(accessMode, { isOwner, senderIsElite, senderHasFullAccess }) {
    switch (accessMode) {
        case "dev":    
            return isOwner;
        case "owner":  
            return isOwner || senderHasFullAccess;
        case "elite":  
            return isOwner || senderHasFullAccess || senderIsElite;
        case "public": 
        default:
            return true;
    }
}

async function safeSendMessage(sock, jid, msg, options = {}) {
    try {
        return await sock.sendMessage(jid, msg, options);
    } catch (err) {
        if (err?.data === 429) {
            await new Promise(r => setTimeout(r, 2000));
            return await sock.sendMessage(jid, msg, options);
        }
        throw err;
    }
}


function attachSystemLogger(sock) {
    if (systemLoggerSock === sock) return;

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            let logMsg = "";

            if (statusCode === 408) {
                logMsg = "⚠ [SYSTEM CRITICAL]: Internet Connection Lost (408).";
            } else if (statusCode === 440) {
                logMsg = "👮‍♂️ [SECURITY ALERT]: Session Conflict (440).";
            } else if (statusCode === DisconnectReason.loggedOut) {
                logMsg = "⛔ [SYSTEM]: Device Logged Out.";
            } else if (statusCode === DisconnectReason.forbidden) {
                logMsg = "🚫 [SYSTEM]: Account BANNED.";
            } else {
                logMsg = `ℹ [SYSTEM]: Connection Closed (${statusCode}).`;
            }
            
            
            logToHistory(`__________________\n${logMsg}\n__________________`);
        }
        
        if (connection === 'open') {
             logToHistory(`__________________\n✅ [SYSTEM]: Bot Connected (${sock.user?.id})\n__________________`);
        }
    });

    systemLoggerSock = sock;
}


export async function initializePlugins(themeColor) {
    try {
        
        let hexColor = themeColor || '#00FF00';
        if (!hexColor.startsWith('#')) hexColor = '#' + hexColor;

        
        plugins = await loadPlugins(hexColor);
        
        
        console.log(chalk.hex(hexColor).bold("🔌 PLUGINS LOADED & READY."));
    } catch (err) {
        console.error("Error loading plugins:", err);
        logToHistory(`__________________\n❌ [ERROR]: Plugin Loading Failed\nMSG: ${err.message}\n__________________`); 
    }
}

export async function handleMessages(sock, { messages }) {

    sockGlobal = { ...sock, ...elitePro, ...waUtils };
    if (!sockGlobal.ev && sock.ev) sockGlobal.ev = sock.ev;
    
    attachSystemLogger(sock);

    messageBuffer.push(...messages);
}

setInterval(async () => {
    if (messageBuffer.length === 0) return;
    const messagesToProcess = [...messageBuffer];
    messageBuffer.length = 0;

    for (const msg of messagesToProcess) {
        try {
            if (sockGlobal) await handleSingleMessage(sockGlobal, msg);
        } catch (err) {
            console.error(chalk.red("❌ كراش صامت في الكود:"), err);
        }
    }
}, 100);


async function handleSingleMessage(sock, msg) {
const chatId = msg.key.remoteJid;

const text =
  msg.message?.conversation ||
  msg.message?.extendedTextMessage?.text || "";

const cleanText = text.trim().toLowerCase();

if (!msg.message || !msg.key) return;

    // Stage 10 (Dashboard Redesign & Visualization) - count every inbound
    // message the bot actually processes (real "Messages" telemetry for
    // the Dashboard), before any command-prefix filtering below. Does not
    // affect what happens to the message afterward - see
    // handlers/telemetry.js#recordMessage (best-effort, never throws).
    telemetry.recordMessage();

    if (activeListeners.has(chatId)) {
        return; 
    }

    const isGroup = chatId.endsWith("@g.us");
    const messageText = msg.message?.conversation || 
                        msg.message?.extendedTextMessage?.text || 
                        msg.message?.imageMessage?.caption || 
                        msg.message?.videoMessage?.caption || "";

    const { prefix, botState, modeState, accessMode } = getLiveSystemConfig();

    if (!messageText.startsWith(prefix)) return;

    const BIDS = {
        pn: sock.user.id.split(":")[0] + "@s.whatsapp.net",
        lid: sock.user.lid?.split(":")[0] + "@lid",
    };

    const sender = {
        name: msg.pushName || "Unknown",
        pn: msg.key.participantAlt || 
            (msg.key.remoteJidAlt?.endsWith("s.whatsapp.net") && msg.key.fromMe ? BIDS.pn : msg.key.remoteJidAlt) || 
            (msg.key.fromMe ? BIDS.pn : (isGroup ? msg.key.participant : chatId)),
        lid: msg.key.participant || 
             (msg.key.remoteJid?.endsWith("lid") && msg.key.fromMe ? BIDS.lid : msg.key.remoteJid) || 
             null,
    };

    if (sender.pn) sender.pn = normalizeJid(sender.pn) + "@s.whatsapp.net";

    const args = messageText.slice(prefix.length).trim().split(/\s+/);
    const command = args.shift()?.toLowerCase();
    
    if (!command) return;

    let senderIsElite = false;
    try { senderIsElite = await sock.isElite({ sock, id: sender.pn }); } catch (e) {}

    

// --- All of the role/access checks below live in handlers/permissions.js
// (handlers/developer.js and elite-pro.js remain the single sources of
// truth for the actual ids — permissions.js only reads from them, nothing
// is duplicated). The local function names (hasFullAccess,
// isHardcodedBypassJid) and the shape of `isOwner` are kept exactly as
// before so every call site further down in this file needs no changes.
//
// Permission model: USER < ELITE < OWNER < DEVELOPER (flat 4-rank
// hierarchy). The old middle "Sub-Owner" tier and its restricted-folders
// exception have been removed from the active permission system — a
// dynamic Owner now has exactly the same access as a hardcoded
// Owner/Developer, they just aren't the SAME rank (see isHardcodedOwner
// below, which is what canExecute()'s `dev: "on"` gate and
// resolveSenderLevel() use to tell them apart).
const ownerNumbers = developer.getDeveloperNumbers();
const ownerLids = developer.getDeveloperLids();

const isOwner = permissions.isOwner({ pn: sender.pn, lid: sender.lid });

// Distinguishes the hardcoded Owner/Developer accounts (handlers/developer.js)
// from Dynamic Owners (اونر اضف). isOwner above is a merged flag (true for
// both); this stays false for a Dynamic Owner, which is what
// resolveSenderLevel()/the `dev: "on"` gate need to rank Developer strictly
// above Owner.
const isHardcodedOwner = permissions.isHardcodedOwner({ pn: sender.pn, lid: sender.lid });

function hasFullAccess() {
    return permissions.hasFullAccess({ isHardcodedOwner, isOwner });
}

// Permanent bypass for hardcoded Owner/Developer numbers. Historically this
// checked a raw JID literal in 5 separate places in this file; centralized
// first into this local function, and now sourced from permissions.js
// (which in turn reads handlers/developer.js — still the single owner of
// these ids).
function isHardcodedBypassJid(jid) {
    return permissions.isHardcodedBypassJid(jid);
}


const senderRole = permissions.resolveSenderRole({ fromMe: msg.key.fromMe, isOwner, isHardcodedOwner });
const eliteStatus = senderIsElite ? "YES" : "NO";
const locationType = isGroup ? "GROUP" : "PRIVATE";

        let ignoreReason = null;

    
    const groupStates = getGroupStates();

    const earlyHandlerForCommand = getPlugins()[command];
    const senderHasFullAccess = hasFullAccess();

    if (botState === "off" && command !== "اعدادات" && command !== "bot" && command !== "تفعيل") {
        ignoreReason = "BOT : OFF = IGNORED";
    } 

else if (isGroup && groupStates[chatId] !== true && command !== "on") {
    ignoreReason = "GROUP IS OFF BY DEFAULT = IGNORED";
}

    else if (!isAllowedByAccessMode(accessMode, { isOwner, senderIsElite, senderHasFullAccess }) && !isHardcodedBypassJid(msg.key.remoteJid)) {
        ignoreReason = `MODE : ${accessMode.toUpperCase()} = IGNORED`;
    }

        
    let logDetails = `__________________
SENDER : ${senderRole}
CMD    : ${command}
JID    : ${sender.pn}
LID    : ${sender.lid}
LOC    : ${locationType}
ELITE  : ${eliteStatus}`;

    if (ignoreReason) {
        logDetails += `\nREASON : ${ignoreReason}`;
    }
    logDetails += `\n__________________`;

    
    console.log(chalk.cyan(`__________________`));
    console.log(chalk.green(`SENDER : ${senderRole}`));
    console.log(chalk.bold.white(`CMD    : ${command}`));
    console.log(chalk.yellow(`JID    : ${sender.pn}`));
    console.log(chalk.magenta(`LID    : ${sender.lid}`));
    console.log(chalk.blue(`LOC    : ${locationType}`));
    console.log(chalk.red(`ELITE  : ${eliteStatus}`));

    if (ignoreReason) {
        console.log(chalk.bgRed.white.bold(` STATUS : ${ignoreReason} `));
    }
    console.log(chalk.cyan(`__________________`));


    logToHistory(logDetails);

    
    if (ignoreReason) return; 

    


    plugins = getPlugins();
    const handler = plugins[command];

    // Stage 8, item #4: a plugin disabled from the Dashboard is refused
    // silently, the same convention already used for every other
    // ignore-reason above (bot off, group off, access mode) - the plugin's
    // file/code is untouched, this is purely a dispatch-time gate.
    if (handler && isCommandDisabled(command)) {
        console.log(chalk.hex('#FFA500')(`COMMAND DISABLED: ${command}`));
        logToHistory(`__________________\n[PLUGIN] DISABLED\nCMD: ${command}\nUSER: ${sender.pn}\n__________________`);
        return;
    }

    if (!handler && !["حدث", "مشاكل"].includes(command)) {
        console.log(chalk.hex('#FFA500')(`COMMAND UNKNOWN: ${command}`));
        logToHistory(`__________________\nUNKNOWN: ${command}\nSENDER: ${sender.pn}\n__________________`);
        return;
    }

    
    if (command === "حدث") {
        if (!senderIsElite && !isOwner && !isHardcodedBypassJid(msg.key.remoteJid)) return;
        try {
            await loadPlugins();
            console.log(chalk.green(`SYSTEM: Reloaded`));
            return await safeSendMessage(sock, chatId, { react: { text: "✅", key: msg.key } });
        } catch (err) { 
            if (messageText.length < 20) playError();
            logToHistory(`__________________\n[ERROR] RELOAD FAILED\nMSG: ${err.message}\n__________________`); 
            return; 
        }
    }

    if (command === "مشاكل") {
        if (!senderIsElite && !isOwner && !isHardcodedBypassJid(msg.key.remoteJid)) return;
        const issues = getPluginIssues();
        const text = issues.length ? `⚠ مشاكل البلوجينات:\n\n${issues.join("\n")}` : "✨ لا توجد مشاكل برمجية.";
        return await safeSendMessage(sock, chatId, { text }, { quoted: msg });
    }

    if (!handler) return;

    msg.chat = chatId;
    msg.args = args;
    msg.sender = sender;
    msg.isOwner = isOwner;
    msg.isHardcodedOwner = isHardcodedOwner;
    msg.command = command;

    if (handler.group === true && !isGroup) {
        return await safeSendMessage(sock, chatId, { text: "❗ هذا الأمر يعمل في المجموعات فقط." }, { quoted: msg });
    }
    if (handler.prv === true && isGroup) {
        return await safeSendMessage(sock, chatId, { text: "❗ هذا الأمر يعمل في الخاص فقط." }, { quoted: msg });
    }


        const executeWithPermissions = async () => {

        
        const permissionCheck = permissions.canExecute(handler, {
            isOwner,
            isHardcodedOwner,
            isElite: senderIsElite,
            isBypass: isHardcodedBypassJid(msg.key.remoteJid),
        });
        if (!permissionCheck.allowed) {
            telemetry.recordSecurity(`CMD: ${command}\nUSER: ${sender?.pn || sender?.lid || "unknown"}\nCHAT: ${chatId}\nREASON: ${permissionCheck.reason}`);
            await permissions.denyExecution({ sock, chatId, msg, reason: permissionCheck.reason });
            return;
        }

        // Optional per-plugin Cooldown (Stage 3, item #9). Only enforced when
        // the handler explicitly sets `cooldown` (ms) - see handlers/plugins.js.
        // Silent-by-default (a light ⏳ reaction), same convention as the
        // rest of this file's denial points.
        const cooldownCheck = checkCooldown(handler, command, sender);
        if (cooldownCheck.onCooldown) {
            await safeSendMessage(sock, chatId, { react: { text: "⏳", key: msg.key } });
            logToHistory(`__________________\n[COOLDOWN] BLOCKED\nCMD: ${command}\nUSER: ${sender.pn}\nREMAINING_MS: ${cooldownCheck.remainingMs}\n__________________`);
            return;
        }
        markCooldown(handler, command, sender);

        try {

            const originalIsElite = sock.isElite;
            

            sock.isElite = async (opts) => {
    const idToCheck = opts?.id || opts;
    const pureId = normalizeJid(idToCheck);
    
    
    if (ownerNumbers.includes(pureId)) {
        return true; 
    }
    
    return originalIsElite ? await originalIsElite(opts) : false;
};


            await handler.execute({ sock, msg, args, BIDS, sender });
            

            sock.isElite = originalIsElite;
            
            playOK();
            telemetry.recordCommand(command, sender, chatId);
        } catch (err) {
            const pluginFile = handler?.filePath ? path.basename(handler.filePath) : "unknown";
            console.error(`❌ Error in ${command}:`, err);
            logToHistory(`__________________\nPlugin Error\nPlugin: ${pluginFile}\nCommand: ${command}\nError: ${err.message}\n__________________`);
            telemetry.recordError(command, err, pluginFile);
            try { recordCommandRuntimeError(command, err.message); } catch (e) { /* Stage 8 tracking must never break error handling */ }
            if (messageText.length < 20) playError();
            await safeSendMessage(sock, chatId, { text: `❌ خطأ برمجي:\n${err.message}` }, { quoted: msg });
        }
    };



    // "قفل" (lock: "on") = Owner + Developer only. No password fallback: if
    // the sender doesn't have hasFullAccess() (hardcoded Owner/Developer, or
    // a dynamic Owner) and isn't the hardcoded bypass jid, they are denied
    // outright - no shared password can unlock this. This replaces the old
    // interactive password-prompt flow (previously ~100 lines below this
    // point: a message listener that collected up to 3 password attempts
    // via getSystemPassword()). The "اعدادات" control panel's password
    // view/set feature is untouched - only this specific "type the password
    // to bypass a locked command" path was removed, since `lock` no longer
    // means "requires a shared secret", it means "requires actually being
    // an Owner or Developer".
    if (handler.lock === "on" && !msg.key.fromMe && !hasFullAccess() && !isHardcodedBypassJid(msg.key.remoteJid)) {
        telemetry.recordSecurity(`CMD: ${command}\nUSER: ${sender?.pn || sender?.lid || "unknown"}\nCHAT: ${chatId}\nREASON: lock_owner_only`);
        logToHistory(`__________________\n[LOCK] DENIED (owner-only)\nCMD: ${command}\nUSER: ${sender.pn}\n__________________`);
        await safeSendMessage(sock, chatId, { react: { text: "🔒", key: msg.key } });
        return;
    }

    await executeWithPermissions();
}
