import fs from "fs";
import path from "path";

const AstaPlugin = Object.freeze({
  command: "استقبال",
  description: "تشغيل/إيقاف رسالة الاستقبال",
  elite: "off",
  requiredLevel: "elite",
  group: true,
  prv: false,
  lock: "off",
  dev: "off",
  asta: "on"
});

const filePath = path.join(process.cwd(), "asta", "welcomeGroups.json");

function loadData() {
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, "{}");
  return JSON.parse(fs.readFileSync(filePath));
}

function saveData(data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}


async function execute({ sock, msg }) {
  const chatId = msg.key.remoteJid;
  const data = loadData();

  if (data[chatId]) {
    delete data[chatId];
    saveData(data);

    return sock.sendMessage(chatId, {
      text: "❌ تم إيقاف الاستقبال في هذا الجروب"
    }, { quoted: msg });
  } else {
    data[chatId] = true;
    saveData(data);

    return sock.sendMessage(chatId, {
      text: "✅ تم تفعيل الاستقبال في هذا الجروب"
    }, { quoted: msg });
  }
}

export default { AstaPlugin, execute };