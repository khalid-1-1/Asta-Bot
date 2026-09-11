import { downloadContentFromMessage } from '@whiskeysockets/baileys';

async function execute({ sock, msg }) {
    try { 
        const chatId = msg.key.remoteJid;

        if (!chatId.endsWith('@g.us')) {
            return sock.sendMessage(chatId, { text: 'هذا الأمر يعمل فقط في الجروبات.' }, { quoted: msg });
        }

        const metadata = await sock.groupMetadata(chatId);
        const participants = metadata.participants;

        
        const owner = metadata.owner || participants.find(p => p.admin === "superadmin")?.id;

        
        const admins = participants.filter(p => p.admin);

        
        const members = participants.filter(p => !p.admin);

        
        let groupPic;
        try {
            groupPic = await sock.profilePictureUrl(chatId, "image");
        } catch {
            groupPic = null;
        }

        
        let text = `┓┅ ━━━━━━━━━━━━━━━ ┅┏
┃╻💬╹↵ ❮ *منـشـن جـمـاعـي* ❯ ↯
┃╻🔖╹↵ ❮  *${metadata.subject}*  ❯
┃╻👥╹↵ ❮ عدد الأعضاء : *${participants.length}* ❯
┫┅ ━━━━━━━━━━━━━━━ ┅ ━┣
┃╻👑╹↵ ❮ *المالك* ❯ ↯
┃╻🔖╹↵ @${owner.split("@")[0]}
┫┅ ━━━━━━━━━━━━━━━ ┅ ━┣
┃╻🕵🏻‍♂️╹↵ ❮ *المشرفون* ❯ ↯
`;

admins.forEach((a, i) => {
    text += `┃ ${i + 1}- @${a.id.split("@")[0]}\n`;
});

text += `┫┅ ━━━━━━━━━━━━━━━ ┅ ━┣
┃╻👥╹↵ ❮ *الأعضاء* ❯ ↯
`;

members.forEach((m, i) => {
    text += `┃ ${i + 1}- @${m.id.split("@")[0]}\n`;
});

text += `┛┅ ━━━━━━━━━━━━━━━ ┅ ━┗

> *𝑨𝑺𝑻𝑨 𝑩𝑶𝑻 🩸*`;

        
        const mentions = participants.map(p => p.id);
        await sock.sendMessage(chatId, { delete: msg.key });


        
        await sock.sendMessage(chatId, {
    image: groupPic ? { url: groupPic } : undefined,
    caption: text,
    mentions: mentions
});

    } catch (err) {
        console.error('❌ خطأ:', err);
        return sock.sendMessage(msg.key.remoteJid, {
            text: `❌ حدث خطأ:\n${err.message || err.toString()}`
        }, { quoted: msg });
    }
}

export const AstaPlugin = {
    command: 'جماعي',
    description: 'منشن جماعي احترافي مع تقسيم الأعضاء',
    elite: "off",
    group: true,
    prv: false,
    lock: "on",
  dev: "off",
};

export default { AstaPlugin, execute };