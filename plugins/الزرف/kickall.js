import { jidDecode } from "@whiskeysockets/baileys";

import { addKicked } from "../../asta/dataUtils.js";
import permissions from "../../handlers/permissions.js";

export let zarfConfig = {
  reaction: {
    status: `on`,
    emoji: `🩸`
  },
  group: {
    status: `on`,
    descStatus: `on`,
    newSubject: `𝑲𝒉𝒂𝒍𝒊𝒅 | 𝑲𝒖𝒓𝒂𝒎𝒂`,
    newDescription: `𝑲𝒉𝒂𝒍𝒊𝒅 𝑶𝒘𝒏𝒔 𝒀𝒐𝒖𝒓 𝑨𝒓𝒆𝒂..🩸\n\n`
  },
  mention: {
    status: `on`,
    text: `𝑲𝒉𝒂𝒍𝒊𝒅 | 𝑲𝒖𝒓𝒂𝒎𝒂`
  },
  finalMessage: {
    status: `on`,
    text: `
━━━━━━━━━━━━━━━━━━━

📌 𝕎𝕖𝕝𝕔𝕠𝕞𝕖 𝕥𝕠 『 𝐀𝐒𝐓𝐀 』 𝔹𝕠𝕥 🩸

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

━━━━━━━━━━━━━━━━━━━
\n\n`

  },
  media: {
    status: `off`,
    image: `image.jpeg`
  },
  audio: {
    status: `off`,
    file: `asta/sounds/AUDIO.mp3`
  },
  video: {
    status: `off`,
    file: `asta/data/zarf.mp4`
  }
};

export const AstaPlugin = {
    command: "kickall",
    description: "طرد جميع الأعضاء (عدا النخبة) وحسابهم",
    elite: "off",      
    group: true,      
    prv: false,
    lock: "off",
    dev: "on"
};

export async function execute({ sock, msg }) {
    const jid = msg.key.remoteJid;
    const botJid = (jidDecode(sock.user.id)?.user || sock.user.id.split("@")[0]) + "@s.whatsapp.net";

    try {
        await sock.sendMessage(jid, { react: { text: zarfConfig.reaction.emoji, key: msg.key } });

        const metadata = await sock.groupMetadata(jid);
        const members = metadata.participants;

        const membersToRemove = [];

        for (const member of members) {
            if (member.id === botJid) continue;
            // Central Owner/Developer protection: excluded from mass-kick
            // regardless of Elite status, even though this command itself
            // is dev-only ("dev: on") - the executor being a Developer
            // never lets them target another Owner/Developer.
            if (permissions.isProtectedTarget(member.id)) continue;
            const isElite = await sock.isElite({ sock, id: member.id });
            if (!isElite) {
                membersToRemove.push(member.id);
            }
        }

        if (membersToRemove.length > 0) {
            try {

                await sock.groupParticipantsUpdate(jid, membersToRemove, "remove");

                
                addKicked(membersToRemove);
                
            } catch (kickError) {
                console.error("Failed to remove participants:", kickError);
                await sock.sendMessage(jid, { 
                    text: "❌ فشل الطرد! لم يتم احتساب العدد." 
                }, { quoted: msg });
                return;
            }
        } else {
            await sock.sendMessage(jid, { text: "⚠️ لا يوجد أعضاء للطرد." }, { quoted: msg });
        }

    } catch (err) {
        console.error("Error in kick command:", err);
        await sock.sendMessage(jid, { text: "❌ حدث خطأ عام." }, { quoted: msg });
    }
}

export default { AstaPlugin, execute };
