import { getUniqueKicked } from '../../asta/dataUtils.js';

const AstaPlugin = {
    command: "مزروفين",
    description: "فحص وكشف الأعضاء المزروفين المتواجدين في المجموعة مع تواريخ رصدهم",
    elite: "off",
    group: true,   
    prv: false,
    lock: "off",
    dev: "on"
};

async function execute({ sock, msg }) {
    const chatId = msg.key.remoteJid;


    let groupMetadata;
    try {
        groupMetadata = await sock.groupMetadata(chatId);
    } catch (e) {
        return await sock.sendMessage(chatId, { text: "❌ *فشل في جلب بيانات المجموعة، تأكد أن البوت مشرف.*" }, { quoted: msg });
    }

 
    const kickedMap = getUniqueKicked(); 
    
    if (kickedMap.size === 0) {
        return await sock.sendMessage(chatId, { text: "✅ *قاعدة بيانات المزروفين فارغة حالياً.*" }, { quoted: msg });
    }

    const participants = groupMetadata.participants;
    const foundList = []; 

    
    for (const participant of participants) {
        const userJid = participant.id; 
        const userNumber = userJid.split('@')[0];
        

        const searchKey = userNumber + '@lid';

        if (kickedMap.has(searchKey)) {
           
            const timestamp = kickedMap.get(searchKey);
            

            const dateObj = new Date(timestamp);
            const dateStr = dateObj.toLocaleDateString('en-GB'); 
            const timeStr = dateObj.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });

            foundList.push({
                jid: userJid,
                formattedDate: `${dateStr} - ${timeStr}`
            });
        }
    }

    
    if (foundList.length > 0) {
        let txt = `🕵️‍♂️ *المزروفين من بوتك هنا :*\n\n`;
        txt += `🔢 *العدد المرصود :* ${foundList.length}\n`;
        txt += `➖`.repeat(8);
        
        const mentions = [];

        foundList.forEach((item, index) => {
            txt += `\n${index + 1}. @${item.jid.split('@')[0]}`;
            txt += `\n   └ 🗓️ ${item.formattedDate}`; 
            mentions.push(item.jid);
        });

        txt += `\n\n🛡️ *kurama System Security*`;

        await sock.sendMessage(chatId, { 
            text: txt, 
            mentions: mentions 
        }, { quoted: msg });

    } else {
        await sock.sendMessage(chatId, { 
            text: "مافي حد انزرف منك موجود هنا.." 
        }, { quoted: msg });
    }
}

export default { AstaPlugin, execute };
