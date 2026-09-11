async function execute({ sock, msg }) {
    try {
        const chatId = msg.key.remoteJid;

        if (!chatId.endsWith('@g.us')) {
            return sock.sendMessage(chatId, { 
                text: '❌ هذا الأمر يعمل فقط في المجموعات.' 
            }, { quoted: msg });
        }

        const groupMetadata = await sock.groupMetadata(chatId);

        
        let pp;
        try {
            pp = await sock.profilePictureUrl(chatId, 'image');
        } catch {
            pp = 'https://i.imgur.com/2wzGhpF.jpeg';
        }

        const participants = groupMetadata.participants;

        
        const owner = groupMetadata.owner 
            || participants.find(p => p.admin === 'superadmin')?.id 
            || chatId.split('-')[0] + '@s.whatsapp.net';

        
        const admins = participants.filter(p => p.admin);

        const listAdmin = admins.map((v, i) => 
            `┃ ${i + 1}- @${v.id.split('@')[0]}`
        ).join('\n');

        
        const text = `
┓┅ ━━━━━━━━━━━━━━━ ┅┏
┃╻📊╹↵ ❮ *معلومات الجروب* ❯ ↯
┃╻🔖╹↵ ❮ *الاسم :  ${groupMetadata.subject}*  ❯
┃╻👥╹↵ ❮ *عدد الأعضاء : ${participants.length}* ❯
┫┅ ━━━━━━━━━━━━━━━ ┅ ━┣
┃╻👑╹↵ ❮ *المالك* ❯ ↯
┃╻🔖╹↵ @${owner.split('@')[0]}
┫┅ ━━━━━━━━━━━━━━━ ┅ ━┣
┃╻🕵🏻‍♂️╹↵ ❮ *المشرفون* ❯ ↯
${listAdmin}
┫┅ ━━━━━━━━━━━━━━━ ┅ ━┣
┃╻📌╹↵ ❮ *الوصف* ❯ ↯
┃ ${groupMetadata.desc?.toString() || '*لا يوجد وصف*'}
┛┅ ━━━━━━━━━━━━━━━ ┅ ━┗

> *𝑨𝑺𝑻𝑨 𝑩𝑶𝑻 🩸*
`.trim();

        
        const mentions = [...admins.map(v => v.id), owner];

        await sock.sendMessage(chatId, {
            image: { url: pp },
            caption: text,
            mentions
        }, { quoted: msg });

    } catch (err) {
        console.error(err);
        sock.sendMessage(msg.key.remoteJid, {
            text: "❌ حصل خطأ"
        }, { quoted: msg });
    }
}

export const AstaPlugin = {
    command: 'inf',
    description: 'عرض معلومات الجروب',
    elite: "off",
    group: true,
    prv: false,
    lock: "on",
  dev: "off",
};

export default { AstaPlugin, execute };