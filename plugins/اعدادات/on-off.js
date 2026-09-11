import fs from "fs";
import path from "path";
import developer from "../../handlers/developer.js";

const AstaPlugin = Object.freeze({
  command: ["on", "off"],
  description: "تفعيل أو إيقاف البوت داخل الجروب",
  elite: "off",
  group: true,
  prv: false,
  lock: "on",
  dev: "off",
  asta: "on"
});

const dataDir = path.join(process.cwd(), "asta", "data");
const groupStatesPath = path.join(dataDir, "groupStates.json");

function getGroupStates() {
  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
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

async function execute({ sock, msg }) {
  const chatId = msg.key.remoteJid;

  // "lock: on" already restricts execution to Owner/Developer (hardcoded or
  // dynamic) or the hardcoded bypass jid at the framework level (see
  // handlers/messages.js). This inline check is kept only as defense in
  // depth; the old Sub-Owner reference (msg.isSubOwner) has been removed
  // since that tier no longer exists.
  const bypassJid = developer.normalize(msg.key.remoteJid);
  if (!msg.key.fromMe && !msg.isOwner && !developer.getDeveloperNumbers().includes(bypassJid)) {
    return;
  }

  
  if (msg.command === "off") {
    saveGroupState(chatId, false);
    return await sock.sendMessage(chatId, { text: "Bot is Off ❌" }, { quoted: msg });
  }

  saveGroupState(chatId, true);
  return await sock.sendMessage(chatId, { text: "Bot is On ✅️" }, { quoted: msg });
}

export default { AstaPlugin, execute };