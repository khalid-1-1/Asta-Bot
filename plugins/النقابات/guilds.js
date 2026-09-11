import fs from "fs";
import path from "path";

const AstaPlugin = Object.freeze({
  command: "استمارات",
  description: "نظام استمارات حديث",
  elite: "off",
  group: false,
  prv: false,
  lock: "off",
  dev: "off",
  asta: "on"
});

const sessions = new Map();
const listeners = new Map();

function loadGuilds() {
  const file = path.join(process.cwd(), "asta", "guilds.json");
  if (!fs.existsSync(file)) fs.writeFileSync(file, "{}");
  return JSON.parse(fs.readFileSync(file));
}

async function execute({ sock, msg }) {
  const chatId = msg.key.remoteJid;

  const guilds = loadGuilds();
  const names = Object.keys(guilds);

  if (!names.length) {
    return sock.sendMessage(chatId, { text: "❌ لا توجد استمارات" }, { quoted: msg });
  }

  let text = "*📜 قائمة الاستمارات 📜 :*\n\n";
  names.forEach((g, i) => {
    text += `『 ${i + 1} 』 ${g}\n`;
  });

  text += "\n*✍️ اختار `رقم` الاستمارة*\n*⛔ اكتب `خروج` للالغاء*";

  await sock.sendMessage(chatId, { text }, { quoted: msg });

  sessions.set(chatId, {
    state: "MAIN",
    selected: null
  });

  const listener = async ({ messages }) => {
    const m = messages[0];
    if (!m.message) return;
    if (m.key.remoteJid !== chatId) return;

    const input =
      m.message?.conversation ||
      m.message?.extendedTextMessage?.text ||
      "";

    const session = sessions.get(chatId);
    if (!session) return;

    
    if (input === "خروج") {
      sock.ev.off("messages.upsert", listener);
      listeners.delete(chatId);
      sessions.delete(chatId);
      return;
    }

    
    if (session.state === "MAIN") {
      const index = parseInt(input) - 1;

      if (names[index]) {
        session.selected = names[index];
        const guild = guilds[session.selected];

        let menu = `*📜 ${session.selected} 📜*\n${guild.desc}\n\n`;

        for (const key in guild.commands) {
          menu += `『 ${key} 』 ${guild.commands[key].name}\n`;
        }

        menu += "\n*✍️ اختار `رقم` القسم*\n↩️ رجوع";

        await sock.sendMessage(chatId, {
          text: menu
        }, { quoted: msg });

        session.state = "GUILD";
      }
    }

    
    else if (session.state === "GUILD") {
      if (input === "رجوع") {
        sock.ev.off("messages.upsert", listener);
        listeners.delete(chatId);
        sessions.delete(chatId);
        return execute({ sock, msg });
      }

      const guild = guilds[session.selected];
      const cmd = guild.commands[input];

      if (cmd) {
        
        if (Array.isArray(cmd.reply)) {
          for (const text of cmd.reply) {
            await sock.sendMessage(chatId, { text: text }, { quoted: m });
          }
        } else {
          
          await sock.sendMessage(chatId, { text: cmd.reply }, { quoted: m });
        }
      }
    }
  };

  if (listeners.has(chatId)) {
    sock.ev.off("messages.upsert", listeners.get(chatId));
  }
  listeners.set(chatId, listener); 
  sock.ev.on("messages.upsert", listener);

  setTimeout(() => {
    sock.ev.off("messages.upsert", listener);
    listeners.delete(chatId);
    sessions.delete(chatId);
  }, 180000);

}

export default { AstaPlugin, execute };
