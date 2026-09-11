import { jidDecode } from "@whiskeysockets/baileys";
import permissions from "../../handlers/permissions.js";

const decode = jid =>
  (jidDecode(jid)?.user || jid.split("@")[0]) + "@s.whatsapp.net";

async function execute({ sock, msg, args }) {

    const chatId = msg.key.remoteJid;

    const react = async (emoji) => {
        if (chatId.endsWith("@g.us")) {
            return sock.sendMessage(chatId,{
                react:{ text: emoji, key: msg.key }
            });
        }
    };

    try {

        if (!chatId.endsWith("@g.us")) {
            return await react("❌");
        }

        const quoted = msg.message?.extendedTextMessage?.contextInfo;

        

        if (!quoted || !quoted.stanzaId || !quoted.participant) {
            return await react("❌");
        }

        // Central Owner/Developer protection: a message sent by an Owner
        // (hardcoded or dynamic) or Developer can never be deleted through
        // this command - even by a Developer running "حذف" themselves.
        // Exception: the bot's own messages are never protected here (the
        // bot's linked number may itself be a hardcoded Owner/Developer
        // account, and deleting the bot's own messages is normal, expected
        // behavior, not a punitive action against a person).
        const isBotOwnMessage = quoted.participant === decode(sock.user.id);
        if (!isBotOwnMessage && permissions.isProtectedTarget(quoted.participant)) {
            return await react("🚫");
        }

        await sock.sendMessage(chatId,{
            delete:{
                remoteJid: chatId,
                fromMe: quoted.participant === decode(sock.user.id),
                id: quoted.stanzaId,
                participant: quoted.participant
            }
        });

        await sock.sendMessage(chatId,{
            delete:{
                remoteJid: chatId,
                fromMe: msg.key.fromMe,
                id: msg.key.id,
                participant: msg.key.participant || chatId
            }
        });

        await react("✅");

    } catch (err){

        console.log("Delete Error:",err);
        await react("❌");

    }

}

export const AstaPlugin = {
    command: ["حذف"],
    description: "حذف رسالة عند الرد عليها",
    elite: "off",
  requiredLevel: "elite",
    group: true,
    prv: false,
    lock: "off",
  dev: "off",
};

export default { AstaPlugin, execute };