import fs from "fs";
import path from "path";

const AstaPlugin = Object.freeze({
  command: "حذف_قسم",
  description: "حذف قسم من داخل نظام الاستمارات",
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

  
  const input = fullText.replace(/^حذف_قسم\s*/, "").split(/\s*\|\s*/);

  const guildName = input[0];
  const target = input[1]; 

  if (!guildName || !target) {
    return sock.sendMessage(chatId, {
      text: "❌ استخدم: حذف_قسم الاستمارة | رقم القسم أو اسمه\n\nمثال بالرقم: حذف_قسم المسابقات | 1\nمثال بالاسم: حذف_قسم المسابقات | ديث نوت"
    }, { quoted: msg });
  }

  const file = path.join(process.cwd(), "asta", "guilds.json");
  if (!fs.existsSync(file)) {
    return sock.sendMessage(chatId, { text: "❌ لا توجد أي بيانات حالياً" }, { quoted: msg });
  }

  const data = JSON.parse(fs.readFileSync(file));

  if (!data[guildName]) {
    return sock.sendMessage(chatId, { text: "❌ الاستمارة غير موجودة" }, { quoted: msg });
  }

  const cmds = data[guildName].commands;
  let foundKey = null;

  
  if (cmds[target]) {
    foundKey = target;
  } else {
    for (const key in cmds) {
      if (cmds[key].name === target) {
        foundKey = key;
        break;
      }
    }
  }

  if (!foundKey) {
    return sock.sendMessage(chatId, { text: "❌ هذا القسم غير موجود في هذه الاستمارة" }, { quoted: msg });
  }

  const deletedName = cmds[foundKey].name;
  
  
  delete cmds[foundKey];

 
  const remainingCmds = Object.values(cmds);
  const reIndexedCmds = {};
  
  remainingCmds.forEach((cmd, index) => {
    reIndexedCmds[index + 1] = cmd;
  });

  data[guildName].commands = reIndexedCmds;

  
  fs.writeFileSync(file, JSON.stringify(data, null, 2));

  sock.sendMessage(chatId, { 
    text: `✅ تم حذف قسم (*${deletedName}*) بنجاح وإعادة ترتيب الأقسام.` 
  }, { quoted: msg });
}

export default { AstaPlugin, execute };
