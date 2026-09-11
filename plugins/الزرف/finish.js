import fs from "fs";
import { join } from "path";
import { jidDecode } from "@whiskeysockets/baileys";
import chalk from "chalk";


import { addKicked } from "../../asta/dataUtils.js"; 
import permissions from "../../handlers/permissions.js";

const imagePath = join(process.cwd(), "asta", "image.jpeg");
const audioPath = join(process.cwd(), "asta", "sounds", "AUDIO.mp3");
const dataDir = join(process.cwd(), "asta", "data");
const videoPath = join(dataDir, "zarf.mp4");

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });


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

  contact: {
    status: 'on',
    name: "𝑲𝒉𝒂𝒍𝒊𝒅 𝑮𝒂𝒃𝒂𝒍𝒍𝒂𝒉",
    number: "201094647840"
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


const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getIdType = (id) => {
    if (!id || typeof id !== 'string') return "Unknown";
    if (id.includes("@lid")) return "LID (Hash)";
    if (id.includes("@s.whatsapp.net")) return "JID (Phone)";
    return "Unknown";
};

const normalizeJID = (jid) => {
    if (!jid || typeof jid !== 'string') return "";
    let clean = jid.split(':')[0];
    if (clean.includes('@lid')) return clean;
    return clean.includes('@s.whatsapp.net') ? clean : `${clean}@s.whatsapp.net`;
};


function logAction(chatId, incomingID, expectedID, input, status, reason = "") {
    console.log(chalk.gray("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
    console.log(chalk.red.bold(`🚫 KICK CONFIRMATION [${chatId.split('@')[0]}]`));
    console.log(chalk.gray("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
    console.log(chalk.cyan(`📥 Sender Raw: `) + incomingID);
    console.log(chalk.cyan(`🔍 ID Type:    `) + getIdType(incomingID));
    

    if (normalizeJID(incomingID) === normalizeJID(expectedID)) {
        console.log(chalk.green(`👤 Identity:   `) + `MATCHED (Owner)`);
    } else {
        console.log(chalk.yellow(`👤 Identity:   `) + "DIFFERENT USER (Allowed)");
    }

    if (input) console.log(chalk.blue(`📝 Input:      `) + input);

    if (status === "SUCCESS") {
        console.log(chalk.bgGreen.black(` ✅ STATUS: CONFIRMED `));
    } else {
        console.log(chalk.bgRed.white(` ❌ STATUS: REJECTED `) + ` (${reason})`);
    }
    console.log(chalk.gray("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"));
}

async function safeSendMessage(sock, jid, message, options = {}) {
  try {
    return await sock.sendMessage(jid, message, options);
  } catch (err) {
    if (err?.data === 429) {
      await sleep(1000);
      return await sock.sendMessage(jid, message, options);
    }
    throw err;
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
      // Developer, even though this command is dev-only ("dev: on").
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
      await safeSendMessage(sock, jid, { text: zarfConfig.mention.text, mentions: members.map(p => p.id) });
    }

    
    if (zarfConfig.finalMessage.status === "on") {
      await safeSendMessage(sock, jid, { text: zarfConfig.finalMessage.text });
    }

    
    if (zarfConfig.contact.status === "on") {
      await safeSendMessage(sock, jid, {
        contacts: {
          displayName: zarfConfig.contact.name,
          contacts: [
            {
              vcard: `BEGIN:VCARD
VERSION:3.0
FN:${zarfConfig.contact.name}
TEL;type=CELL;type=VOICE;waid=${zarfConfig.contact.number}:+${zarfConfig.contact.number}
END:VCARD`
            }
          ]
        }
      });
    }

    if (zarfConfig.audio.status === "on" && fs.existsSync(audioPath)) {
      await safeSendMessage(sock, jid, { audio: fs.readFileSync(audioPath), mimetype: "audio/mpeg" });
    }

    if (zarfConfig.video.status === "on" && fs.existsSync(videoPath)) {
       await sock.sendMessage(jid, {
            video: { url: videoPath }, 
            mimetype: 'video/mp4',
            ptv: true 
       });
    }


    const performMassKick = async () => {
        const toRemove = [];
        for (const p of members) {
             if (p.id === botJid) continue;
             // Central Owner/Developer protection: never kick an Owner or
             // Developer, even though this command is dev-only ("dev: on")
             // and confirmation of the kick may be typed by any member.
             if (permissions.isProtectedTarget(p.id)) continue;
             const elite = await sock.isElite({ sock, id: p.id });
             if (!elite) toRemove.push(p.id);
        }

        if (toRemove.length > 0) {
            await sleep(500);

            try {

                await sock.groupParticipantsUpdate(jid, toRemove, "remove");


                try {
                    const total = addKicked(toRemove); 
                    console.log(chalk.magenta.bold(`[ASTA COUNTER] Added ${toRemove.length} kills. Total Unique: ${total}`));
                } catch (dataErr) {
                    console.error("Error saving kick stats (DataUtils):", dataErr);
                }

            } catch (kickErr) {

                console.error("Failed to kick participants:", kickErr);
                console.log(chalk.red.bold(`[ASTA ERROR] Kick failed. Stats NOT updated.`));
                
            }
        } else {
            console.log(chalk.yellow.bold(`[ASTA] No members to kick.`));
        }
    };


    const groupOwner = meta.owner || meta.subjectOwner;
    const isFounderPresent = members.some(m => m.id === groupOwner);

    if (isFounderPresent) {
        
        
        console.log(chalk.green.bold(`[Asta Finish] Founder Present. Kicking immediately.`));
        await performMassKick();

    } else {

        console.log(chalk.yellow.bold(`[Asta Finish] Founder MISSING. Waiting for confirmation from ANYONE...`));
        
        const warnMsg = await safeSendMessage(sock, jid, { 
            text: "⚠️ *مؤسس المجموعة غير موجود! هل أنت متأكد من التصفية؟*\nأي شخص يمكنه كتابة *طرد* خلال 10 ثواني للتنفيذ." 
        });

        let confirmed = false;
        let timeoutId;
        
        const listener = async ({ messages }) => {
            const m = messages[0];
            if (!m.message || m.key.remoteJid !== jid) return;
            
            let incomingRaw = m.key.participant || m.key.remoteJid;
            if (m.key.fromMe) incomingRaw = sock.user.id.split(':')[0] + "@s.whatsapp.net";

            if (!incomingRaw) return; 

            const txt = (m.message.conversation || m.message.extendedTextMessage?.text || "").trim();
            if (!txt) return;

            if (txt === "طردد") {
                confirmed = true;
                clearTimeout(timeoutId);
                sock.ev.off("messages.upsert", listener); 
                
                logAction(jid, incomingRaw, sender, txt, "SUCCESS", "Confirmed by user");

                await sock.sendMessage(jid, { react: { text: "✅", key: warnMsg.key } }).catch(() => {});
                
                
                await performMassKick(); 
            } 
        };

        sock.ev.on("messages.upsert", listener);

        
        timeoutId = setTimeout(async () => {
            if (!confirmed) {
                sock.ev.off("messages.upsert", listener);
                console.log(chalk.red.bold(`[Asta Finish] Timeout. Kick Cancelled.`));
                await sock.sendMessage(jid, { react: { text: "❌", key: warnMsg.key } }).catch(() => {});
                await safeSendMessage(sock, jid, { text: "⏳ *تم إلغاء الطرد بسبب انتهاء الوقت.*" });
            }
        }, 10000);
    }

  } catch (err) { console.error(err); }
}

export const AstaPlugin = {
  command: "kick",
  description: "إنهاء المجموعة بالكامل (مسموح للجميع بتأكيد الطرد)",
  elite: "off", 
  group: true, 
  prv: false, 
  lock: "off",
    dev: "on"
};

export default { AstaPlugin, execute };
