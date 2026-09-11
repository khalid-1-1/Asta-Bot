import { downloadContentFromMessage } from '@whiskeysockets/baileys';

async function execute({sock, msg, args, BIDS, sender}) {
    try {
        const chatId = msg.key.remoteJid;
        const body =
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            "";
        const fullArgs = body.trim().split(/\s+/);
        

        if (!chatId.endsWith('@g.us')) {
            return sock.sendMessage(chatId, { text: 'هذا الأمر يعمل فقط في المجموعات.' }, { quoted: msg });
        }

        
        const groupMetadata = await sock.groupMetadata(chatId);
        const allParticipants = groupMetadata.participants.map(p => p.id);

        
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const quotedMsgKey = msg.message?.extendedTextMessage?.contextInfo?.stanzaId;
        const quotedParticipant = msg.message?.extendedTextMessage?.contextInfo?.participant;

        
        if (quoted && quotedMsgKey) {
            const forwardMsg = {
                key: {
                    remoteJid: chatId,
                    fromMe: false,
                    id: quotedMsgKey,
                    participant: quotedParticipant,
                },
                message: quoted
            };


            return sock.sendMessage(chatId, {
                forward: forwardMsg,
                mentions: allParticipants
            });
        }

        const textFromCommand = fullArgs.slice(1).join(' '); 
        const messageContent = {
            text: textFromCommand || '🩸 𝑲𝑯𝑨𝑳𝑰𝑫 𝑩𝑶𝑻 𝑲𝑼𝑹𝑨𝑴𝑨 🩸', 
            mentions: allParticipants
        };

        await sock.sendMessage(chatId, messageContent);
        
        await sock.sendMessage(chatId, { delete: msg.key });


    } catch (err) {
        console.error('❌ خطأ في أمر منشن:', err);
        return sock.sendMessage(msg.key.remoteJid, {
            text: `❌ حدث خطأ:\n${err.message || err.toString()}`
        }, { quoted: msg });
    }
}

export const AstaPlugin = {
    command: 'منشن',
    description: 'إرسال رسالة أو ملصق مع عمل منشن لجميع أعضاء المجموعة.',
    elite: "off",
  requiredLevel: "elite", 
    group: true, 
    prv: false,
    lock: "off",
  dev: "off",
};

export default { AstaPlugin, execute };
