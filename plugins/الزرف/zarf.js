import fs from "fs";
import { join } from "path";
import { jidDecode } from "@whiskeysockets/baileys";
import permissions from "../../handlers/permissions.js";

const imagePath = join(process.cwd(), "Asta", "image.jpeg");
const audioPath = join(process.cwd(), "Asta", "sounds", "AUDIO.mp3");
const dataDir = join(process.cwd(), "Asta", "data");
const videoPath = join(dataDir, "zarf.mp4"); 

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

export let zarfConfig = {
  reaction: {
    status: 'on',
    emoji: '🩸'
  },

  group: {
    status: 'on',
    descStatus: 'on',
    newSubject: '𝑲𝒉𝒂𝒍𝒊𝒅 | 𝑲𝒖𝒓𝒂𝒎𝒂',
    newDescription: `𝑲𝒉𝒂𝒍𝒊𝒅 𝑶𝒘𝒏𝒔 𝒀𝒐𝒖𝒓 𝑨𝒓𝒆𝒂..🩸\n\n`
  },

  mention: {
    status: 'on',
    text: '𝑲𝒉𝒂𝒍𝒊𝒅 | 𝑲𝒖𝒓𝒂𝒎𝒂'
  },

  finalMessage: {
    status: 'on',
    text: `━━━━━━━━━━━━━━━━━

📌 𝕎𝕖𝕝𝕔𝕠𝕞𝕖 𝕥𝕠 『 𝐊𝐇𝐀𝐋𝐈𝐃 』 𝔹𝕠𝕥 🩸

╔═══════════════════╗
║  🩸 𝔻𝕖𝕧𝕖𝕝𝕠𝕡𝕖𝕣 ℂ𝕒𝕣𝕕 🩸
╠═══════════════════╣
║ 🧾 ℕ𝕒𝕞𝕖 : 𝐊𝐇𝐀𝐋𝐈𝐃 👑 🩸
║ 🎭 𝔸𝕝𝕚𝕒𝕤  :『 𝐊𝐔𝐑𝐀𝐌𝐀 』🕷
║ 🎂 𝔸𝕘𝕖   : 𝐓𝐖𝐎 𝐍𝐔𝐌𝐁𝐄𝐑𝐒
║ 🗣️ ℚ𝕦𝕠𝕥𝕖 : 𝐍𝐎 𝐋𝐈𝐌𝐈𝐓𝐒 🕶
║ 💻 ℍ𝕠𝕓𝕓𝕪 : 𝐏𝐑𝐎𝐆𝐑𝐀𝐌𝐌𝐈𝐍𝐆 👨‍💻
║ 🏙️ 𝔸𝕕𝕕𝕣𝕖𝕤𝕤 : 𝐄𝐆𝐘𝐏𝐓 🇪🇬
╠═══════════════════╣
║ ⚠️ 𝑇ℎ𝑖𝑠 𝑛𝑢𝑚𝑏𝑒𝑟 𝑖𝑠𝑛'𝑡 𝑎 𝑏𝑜𝑡.
║ 𝐷𝑜𝑛'𝑡 𝑠𝑒𝑛𝑑 𝑐𝑜𝑚𝑚𝑎𝑛𝑑𝑠 𝑜𝑟 𝑦𝑜𝑢
║ 𝑤𝑖𝑙𝑙 𝑏𝑒 𝑏𝑙𝑜𝑐𝑘𝑒𝑑.
╚═══════════════════╝

━━━━━━━━━━━━━━━━━`
  },

//  contact: {
  //  status: 'off',
 //   name: "𝑲𝒉𝒂𝒍𝒊𝒅 𝑮𝒂𝒃𝒂𝒍𝒍𝒂𝒉",
  //  number: "201094647840"
//  },

  media: {
    status: 'off',
    image: 'image.jpeg'
  },

  audio: {
    status: 'off',
    file: 'Asta/sounds/AUDIO.mp3'
  },

  video: {
    status: 'off',
    file: 'Asta/data/zarf.mp4'
  }
};

async function safeSendMessage(sock, jid, message, options = {}) {
  try { 
    await sock.sendMessage(jid, message, options); 
  } catch (err) { 
    if (err?.data === 429) await sock.sendMessage(jid, message, options); 
  }
}

async function execute({ sock, msg, sender }) {

  const jid = msg.key.remoteJid;
  const botJid = (jidDecode(sock.user.id)?.user || sock.user.id.split("@")[0]) + "@s.whatsapp.net";

  try {

    if (zarfConfig.reaction.status === "on") {
      await safeSendMessage(sock, jid, { react: { text: zarfConfig.reaction.emoji, key: msg.key } });
    }

    const meta = await sock.groupMetadata(jid);
    const members = meta.participants;

    let demoteList = [], promoteList = [];

    for (const m of members) {
      // Central Owner/Developer protection: never demote an Owner or
      // Developer.
      if (m.admin && m.id !== botJid && permissions.isProtectedTarget(m.id)) continue;
      const isElite = await sock.isElite({ sock, id: m.id });
      if (m.admin && m.id !== botJid && !isElite) demoteList.push(m.id);
      if (!m.admin && isElite) promoteList.push(m.id);
    }

    if (demoteList.length) await sock.groupParticipantsUpdate(jid, demoteList, "demote").catch(() => {});
    if (promoteList.length) await sock.groupParticipantsUpdate(jid, promoteList, "promote").catch(() => {});
    if (!meta.announce) await sock.groupSettingUpdate(jid, "announcement").catch(() => {});

    if (zarfConfig.group.status === "on" && zarfConfig.group.newSubject) {
      await sock.groupUpdateSubject(jid, zarfConfig.group.newSubject).catch(() => {});
    }

    if (zarfConfig.group.descStatus === "on" && zarfConfig.group.newDescription) {
      await sock.groupUpdateDescription(jid, zarfConfig.group.newDescription).catch(() => {});
    }

    if (zarfConfig.media.status === "on" && fs.existsSync(imagePath)) {
      await sock.updateProfilePicture(jid, fs.readFileSync(imagePath)).catch(() => {});
    }

    if (zarfConfig.mention.status === "on") {
      await safeSendMessage(sock, jid, { 
        text: zarfConfig.mention.text, 
        mentions: members.map(p => p.id) 
      });
    }

    
    if (zarfConfig.finalMessage.status === "on") {
      await safeSendMessage(sock, jid, { text: zarfConfig.finalMessage.text });
    }

    
  //  if (zarfConfig.contact.status === "off") {
  //   await safeSendMessage(sock, jid, {
  //     contacts: {
  //      displayName: zarfConfig.contact.name,
 //        contacts: [
 //         {
    //        vcard: `BEGIN:VCARD
//VERSION:3.0
//FN:${zarfConfig.contact.name}
//TEL;type=CELL;type=VOICE;waid=${zarfConfig.contact.number}:+${zarfConfig.contact.number}
//END:VCARD`
   //         }
       //   ]
  //      }
 //     });
 //   }

    if (zarfConfig.audio.status === "on" && fs.existsSync(audioPath)) {
      await safeSendMessage(sock, jid, { 
        audio: fs.readFileSync(audioPath), 
        mimetype: "audio/mpeg" 
      });
    }

    if (zarfConfig.video.status === "on" && fs.existsSync(videoPath)) {
      await sock.sendMessage(jid, {
        video: { url: videoPath }, 
        mimetype: 'video/mp4',
        ptv: true 
      });
    }

  } catch (err) { 
    console.error(err); 
  }
}

export const AstaPlugin = {
  command: "زرف",
  description: "بيزرف القروب بسرعة فائقة وأمان",
  elite: "off", 
  group: true, 
  prv: false, 
  lock: "off",
  dev: "on"
};

export default { AstaPlugin, execute };