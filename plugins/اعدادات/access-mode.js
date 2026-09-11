import fs from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import developer from "../../handlers/developer.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const configPath = join(__dirname, "../../asta/config.js");

const AstaPlugin = {
  command: ["وضع", "الوضع", "mode"],
  description: "التحكم في وضع الوصول للبوت (عام / نخبة / اونر / مطور) - للمطور فقط",
  elite: "off", 
  group: false,
  prv: false,
  lock: "off",
  dev: "on",
  asta: "on",
};


const MODE_ALIASES = {
  "عام": "public",
  "عامة": "public",
  "public": "public",

  "نخبة": "elite",
  "النخبة": "elite",
  "elite": "elite",

  "اونر": "owner",
  "أونر": "owner",
  "اونرات": "owner",
  "أونرات": "owner",
  "owner": "owner",

  "مطور": "dev",
  "المطور": "dev",
  "مطورين": "dev",
  "dev": "dev",
};

const MODE_LABELS = {
  public: "🌐 عام ( الجميع )",
  elite: "🔰 النخبة فأعلى",
  owner: "👑 الأونرات فأعلى",
  dev: "🛡 المطور فقط",
};

function getCurrentMode() {
  try {
    const content = fs.readFileSync(configPath, "utf8");
    const match = content.match(/mode:\s*['"](on|off|public|elite|owner|dev)['"]/);
    const raw = match ? match[1] : "off";
    if (raw === "on") return "elite";
    if (raw === "off") return "public";
    return raw;
  } catch (e) {
    return "public";
  }
}

function setMode(newMode) {
  const content = fs.readFileSync(configPath, "utf8");
  const regex = /(mode:\s*['"])(on|off|public|elite|owner|dev)(['"])/;
  const updated = content.replace(regex, `$1${newMode}$3`);
  fs.writeFileSync(configPath, updated, "utf8");
}

async function execute({ sock, msg, args, sender }) {
  const chatId = msg.key.remoteJid;

  
  const isDev = developer.isDeveloper({ pn: sender?.pn, lid: sender?.lid });
  if (!isDev) {
    return; 
  }

  const input = (args[0] || "").trim();

  if (!input) {
    const current = getCurrentMode();
    const help = `
✧━── ❝ 𝑾𝑶𝑹𝑲𝑰𝑵𝑮 𝑴𝑶𝑫𝑬 ❞ ──━✧

*الوضع الحالي:* ${MODE_LABELS[current] || current}

*استخدم:*
\`وضع عام\`   → يشتغل مع الجميع
\`وضع نخبة\`  → النخبة والأونرات والمطور بس
\`وضع اونر\`  → الأونرات والمطور بس
\`وضع مطور\` → المطور بس ( أنت )

✧━── ❝ 𝑲𝒉𝒂𝒍𝒊𝒅 𝐯1 ❞ ──━✧`.trim();
    return await sock.sendMessage(chatId, { text: help }, { quoted: msg });
  }

  const target = MODE_ALIASES[input.toLowerCase()] || MODE_ALIASES[input];

  if (!target) {
    return await sock.sendMessage(
      chatId,
      { text: "❗ وضع غير معروف. جرب: عام / نخبة / اونر / مطور" },
      { quoted: msg }
    );
  }

  try {
    setMode(target);
    await sock.sendMessage(
      chatId,
      { text: `✅ تم تفعيل الوضع: ${MODE_LABELS[target]}` },
      { quoted: msg }
    );
  } catch (err) {
    await sock.sendMessage(
      chatId,
      { text: `❌ حصل خطأ أثناء تغيير الوضع:\n${err.message}` },
      { quoted: msg }
    );
  }
}

export default { AstaPlugin, execute };
