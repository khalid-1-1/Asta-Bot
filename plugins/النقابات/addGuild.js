import fs from "fs";
import path from "path";

const AstaPlugin = Object.freeze({
  command: "اضف_استمارة",
  description: "اضافة استمارة داخل نظام الاستمارات",
  elite: "off",
  requiredLevel: "elite",
  group: false,
  prv: false,
  lock: "off",
  dev: "off",
  asta: "on"
});

async function execute({ sock, msg }) {
  const chatId = msg.key.remoteJid;

  const fullText =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    "";

  const input = fullText.replace(/^اضف_استمارة\s*/, "").split(" | ");

  const name = input[0];
  const desc = input.slice(1).join(" | ");

  if (!name) {
    return sock.sendMessage(chatId, {
      text: "❌ استخدم: اضف_استمارة الاسم | الوصف"
    }, { quoted: msg });
  }

  const file = path.join(process.cwd(), "asta", "guilds.json");
  if (!fs.existsSync(file)) fs.writeFileSync(file, "{}");

  const data = JSON.parse(fs.readFileSync(file));

  if (data[name]) {
    return sock.sendMessage(chatId, { text: "❌ الاستمارة موجودة" }, { quoted: msg });
  }

  data[name] = { desc: desc || "", commands: {} };

  fs.writeFileSync(file, JSON.stringify(data, null, 2));

  sock.sendMessage(chatId, { text: "✅ تم إضافة الاستمارة" }, { quoted: msg });
}

export default { AstaPlugin, execute };