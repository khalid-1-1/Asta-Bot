import fs from "fs";

const GROUPS_FILE = "./groups.json";

const AstaPlugin = Object.freeze({
  command: "add",
  description: "امر خاص بالـ Owner",
  elite: "off",
  group: false,
  prv: false,
  lock: "off",
  dev: "on",
  asta: "on"
});

async function execute({ sock, msg, args }) {
  try {
    if (!args[0]) {
      return sock.sendMessage(msg.key.remoteJid, {
        text: "MISUSE ❌"
      });
    }

    const link = args[0];
    const code = link.split("chat.whatsapp.com/")[1];

    if (!code) {
      return sock.sendMessage(msg.key.remoteJid, {
        text: "MISUSE 1 ❌"
      });
    }

    
    const res = await sock.groupGetInviteInfo(code);

    const groupId = res.id;

    
    let groups = {};
    if (fs.existsSync(GROUPS_FILE)) {
      groups = JSON.parse(fs.readFileSync(GROUPS_FILE));
    }

    
    const newIndex = Object.keys(groups).length + 1;

    groups[newIndex] = groupId;

    fs.writeFileSync(GROUPS_FILE, JSON.stringify(groups, null, 2));

    await sock.sendMessage(msg.key.remoteJid, {
      text: `DONE ${newIndex} ✅`
    });

  } catch (err) {
    console.error(err);

    await sock.sendMessage(msg.key.remoteJid, {
      text: "EROR ❌"
    });
  }
}

export { AstaPlugin, execute };