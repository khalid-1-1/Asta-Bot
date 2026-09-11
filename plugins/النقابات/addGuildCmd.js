import fs from "fs";
import path from "path";

const AstaPlugin = Object.freeze({
  command: "اضف_قسم",
  description: "اضافة اقسام داخل نظام الاستمارات",
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

  
  const cleanText = fullText.replace(/^اضف_قسم\s*/, "");

  
  const parts = cleanText.split(/\s*\|\|\s*/);
  
  const guildName = parts[0]?.trim();
  const cmdName = parts[1]?.trim();
  
  
  const replies = parts.slice(2).map(r => r.trim()).filter(r => r !== "");

  
  if (!guildName || !cmdName || replies.length === 0) {
    return sock.sendMessage(chatId, {
      text: "❌ استخدم الفاصل الجديد (||):\nاضف_قسم اسم الاستمارة || اسم القسم || الرسالة الأولى || الرسالة الثانية"
    }, { quoted: msg });
  }

  const file = path.join(process.cwd(), "asta", "guilds.json");
  if (!fs.existsSync(file)) fs.writeFileSync(file, "{}");

  const data = JSON.parse(fs.readFileSync(file));

  if (!data[guildName]) {
    return sock.sendMessage(chatId, { text: "❌ الاستمارة غير موجودة" }, { quoted: msg });
  }

  const cmds = data[guildName].commands;
  const newIndex = Object.keys(cmds).length + 1;

  
  cmds[newIndex] = {
    name: cmdName,
    reply: replies 
  };

  fs.writeFileSync(file, JSON.stringify(data, null, 2));

  sock.sendMessage(chatId, { text: "✅ تم إضافة القسم بنجاح" }, { quoted: msg });
}

export default { AstaPlugin, execute };
