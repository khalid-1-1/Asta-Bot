import fs from "fs";
import path from "path";

const AstaPlugin = Object.freeze({
  command: "ترحيب",
  description: "تشغيل / إيقاف رسالة الترحيب",
  elite: "off",
  requiredLevel: "elite",
  group: true,
  prv: false,
  lock: "off",
  dev: "off",
  asta: "on"
});

const filePathwelcome = path.join(process.cwd(), "asta", "welcome.json");

function loadDatawelcome() {
  if (!fs.existsSync(filePathwelcome)) fs.writeFileSync(filePathwelcome, "{}");
  return JSON.parse(fs.readFileSync(filePathwelcome));
}

function saveDatawelcome(data) {
  fs.writeFileSync(filePathwelcome, JSON.stringify(data, null, 2));
}

async function execute({ sock, msg }) {
  const chatId = msg.key.remoteJid;
  const data = loadDatawelcome();

  if (data[chatId]) {
    delete data[chatId];
    saveDatawelcome(data);

    return sock.sendMessage(chatId, {
      text: "❌ تم إيقاف الترحيب في هذا الجروب"
    }, { quoted: msg });

  } else {
    data[chatId] = true;
    saveDatawelcome(data);

    return sock.sendMessage(chatId, {
      text: "✅ تم تفعيل الترحيب في هذا الجروب"
    }, { quoted: msg });
  }
}

export default { AstaPlugin, execute };