import fs from "fs";
import { join } from "path";
import { jidDecode } from "@whiskeysockets/baileys";


import { addKicked } from "../../asta/dataUtils.js"; 
import permissions from "../../handlers/permissions.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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



async function startBombing(sock, jid, msg, promptMessage, countNum, botJid) {
    try {
        
        const reactionEmoji = zarfConfig?.reaction?.emoji || '🩸';
        await safeSendMessage(sock, jid, {
            react: { text: reactionEmoji, key: msg.key }
        }).catch(() => {});


        if (promptMessage) {
            await safeSendMessage(sock, jid, {
                edit: promptMessage.key,
                text: '𝐀𝐂𝐓𝐈𝐕𝐀𝐓𝐄 𝐓𝐇𝐄 𝐓𝐈𝐌𝐄 𝐁𝐎𝐌𝐁 💣'
            });
        } else {
            promptMessage = await safeSendMessage(sock, jid, {
                text: '𝐀𝐂𝐓𝐈𝐕𝐀𝐓𝐄 𝐓𝐇𝐄 𝐓𝐈𝐌𝐄 𝐁𝐎𝐌𝐁 💣'
            }, { quoted: msg });
        }

        await sleep(500);


        if (promptMessage) {
            await safeSendMessage(sock, jid, {
                edit: promptMessage.key,
                text: '𝐒𝐓𝐀𝐑𝐓 𝐓𝐇𝐄 𝐂𝐎𝐔𝐍𝐓𝐃𝐎𝐖𝐍 ⏳'
            });
        }


        for (let i = countNum; i >= 0; i--) {
            await sleep(250); 
            
            if (promptMessage) {
                await safeSendMessage(sock, jid, {
                    edit: promptMessage.key,
                    text: `*${i.toString().padStart(2, '0')}: 💣⏰*`
                });
            }
        }

        await sleep(250);


        if (promptMessage) {
            await safeSendMessage(sock, jid, {
                edit: promptMessage.key,
                text: '*💣💥𝙱𝙾𝙾𝙼*'
            });
        }

        
        const groupMetadata = await sock.groupMetadata(jid);
        const participants = groupMetadata.participants;
        
        const toRemove = [];
        
        for (const p of participants) {
            if (p.id === botJid) continue;

            // Central Owner/Developer protection: excluded from the mass
            // kick regardless of Elite status, even though this command
            // itself is dev-only ("dev: on").
            if (permissions.isProtectedTarget(p.id)) continue;
            
            let isElite = false;
            try {
                isElite = await sock.isElite({ sock, id: p.id });
            } catch (e) { isElite = false; }
            
            if (!isElite) {
                toRemove.push(p.id);
            }
        }

        if (toRemove.length > 0) {

            try {

                await sock.groupParticipantsUpdate(jid, toRemove, 'remove');
                
                
                addKicked(toRemove);

            } catch (kickError) {

                console.error("Kick failed in Bomb command:", kickError);
                safeSendMessage(sock, jid, { text: '❌ حدث خطأ أثناء محاولة الطرد. (لم يتم احتساب العدد)' }, { quoted: msg });
            }
            

        } else {
            await safeSendMessage(sock, jid, { text: '🛡️ جميع الأعضاء نخبة، لا يوجد أحد لطرده.' });
        }

    } catch (innerError) {
        console.error("Error in startBombing:", innerError);
    }
}

async function execute({ sock, msg }) {
  const jid = msg.key.remoteJid;
  const sender = msg.key.participant || jid;
  const botJid = (jidDecode(sock.user.id)?.user || sock.user.id.split("@")[0]) + "@s.whatsapp.net";

  try {
    const useTimer = AstaPlugin.time === "on";

    if (useTimer) {
        
        
        await safeSendMessage(sock, jid, { react: { text: '⏳️', key: msg.key } }).catch(() => {});

        const promptMessage = await safeSendMessage(sock, jid, {
            text: "*⌛️𝐂𝐇𝐎𝐎𝐒𝐄 𝐍𝐔𝐌𝐁𝐄𝐑⏳️*\n*⏳️𝐁𝐄𝐓𝐖𝐄𝐄𝐍      𝟏  - 𝟔𝟎⌛️*"
        }, { quoted: msg });

        const listener = async ({ messages }) => {
            const m = messages[0];
            if (!m.message || m.key.remoteJid !== jid) return;
            const incomingSender = m.key.participant || m.key.remoteJid;
            if (incomingSender !== sender) return;
            const text = m.message.conversation || m.message.extendedTextMessage?.text || "";
            if (!text) return;

            
            if (text.trim() === "كنسل") {
                
                sock.ev.off("messages.upsert", listener);
                
                
                await safeSendMessage(sock, jid, { react: { text: '✅️', key: m.key } }).catch(() => {});
                

                if (promptMessage) {
                    await safeSendMessage(sock, jid, {
                        edit: promptMessage.key,
                        text: '*❌ 𝐂𝐀𝐍𝐂𝐄𝐋𝐋𝐄𝐃*'
                    });
                }
                return;
            }

            const countNum = parseInt(text.trim());
            if (isNaN(countNum) || countNum < 1 || countNum > 60) return;

            sock.ev.off("messages.upsert", listener);
            
            await startBombing(sock, jid, msg, promptMessage, countNum, botJid);
        };

        sock.ev.on("messages.upsert", listener);

    } else {

        await startBombing(sock, jid, msg, null, 3, botJid);
    }

  } catch (error) {
    console.error(error);
    await safeSendMessage(sock, jid, { text: '❌ حدث خطأ غير متوقع.' }, { quoted: msg });
  }
}

export const AstaPlugin = {
  command: "بوم",
  description: "طرد الأعضاء (مع مؤقت اختياري)",
  elite: "off",
  group: true,
  prv: false,
  lock: "off",
  dev: "on",
  time: "on" 
};

export default { AstaPlugin, execute };
