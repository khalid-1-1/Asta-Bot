import { getUniqueKicked } from "../../asta/dataUtils.js";


const activeListeners = new Map();

async function execute({ sock, msg }) {
    const jid = msg.key.remoteJid;


    if (activeListeners.has(jid)) {
        const oldListener = activeListeners.get(jid);
        clearTimeout(oldListener.timer);
        sock.ev.off('messages.upsert', oldListener.handler);
        activeListeners.delete(jid);
    }

    try {
        const kickedMap = getUniqueKicked(); 
        

        const kickedSet = new Set(kickedMap.keys());

        let valid = 0;
        let fake = 0;


        for (const id of kickedSet) {
       
            const cleanId = id.split('@')[0];
            const jidTest = cleanId + "@s.whatsapp.net";

            try {
                const res = await sock.onWhatsApp(jidTest);
                if (res?.[0]?.exists) {
                    valid++;
                } else {
                    fake++;
                }
            } catch {
                fake++;
            }
        }

        const total = valid;

        const levels = [
            { threshold: 0, emoji: '🔻' },
            { threshold: 50, emoji: '🔵' },
            { threshold: 100, emoji: '🟠' },
            { threshold: 200, emoji: '🟢' },
            { threshold: 400, emoji: '💲' },
            { threshold: 800, emoji: '🟣' },
            { threshold: 1600, emoji: '🟤' },
            { threshold: 3200, emoji: '🔴' },
            { threshold: 6400, emoji: '⚫' },
            { threshold: 12800, emoji: '⚪' },
            { threshold: 25600, emoji: '🔆' },
            { threshold: 51200, emoji: '⚜️' },
            { threshold: 102400, emoji: '🔱' },
            { threshold: 204800, emoji: '✴️' },
            { threshold: 409600, emoji: '☢️' },
            { threshold: 819200, emoji: '💠' },
            { threshold: 1638400, emoji: '♾️' }
        ];

        let level = 0;
        let emoji = '🔶';

        for (let i = levels.length - 1; i >= 0; i--) {
            if (total >= levels[i].threshold) {
                level = i;
                emoji = levels[i].emoji;
                break;
            }
        }

        const message =
`\`المستوى : ${level} ${emoji}\`
عدد التصفية : ${fake} 🌌`;

        await sock.sendMessage(jid, { text: message }, { quoted: msg });



        const listenerHandler = async ({ messages }) => {
            const newMsg = messages[0];
            if (!newMsg.message || newMsg.key.remoteJid !== jid) return;
            if (newMsg.key.fromMe) return;

            const text = newMsg.message.conversation || newMsg.message.extendedTextMessage?.text || "";

            if (text.trim() === "تحقق") {

                if (activeListeners.has(jid)) {
                    const current = activeListeners.get(jid);
                    clearTimeout(current.timer);
                    sock.ev.off('messages.upsert', current.handler);
                    activeListeners.delete(jid);
                }


                const entries = Array.from(kickedMap.entries()); 
                
               
                const shuffled = entries.sort(() => 0.5 - Math.random());
                

                const selected = shuffled.slice(0, 5);

                if (selected.length === 0) {
                    await sock.sendMessage(jid, { text: "لا يوجد بيانات للتحقق منها." }, { quoted: newMsg });
                    return;
                }

                let verificationMsg = "*✅️Verification  :*\n";
                const mentions = [];

                for (const [id, timestamp] of selected) {
                    const cleanId = id.split('@')[0];
                    const mentionJid = cleanId + "@s.whatsapp.net";
                    
                    
                    const dateObj = new Date(timestamp);
                    const dateStr = dateObj.toLocaleDateString('en-GB');
                    const timeStr = dateObj.toLocaleTimeString('en-US', { hour12: false });

                    verificationMsg += `@${cleanId}\n📅 ${dateStr} - ${timeStr}\n\n`;
                    mentions.push(mentionJid);
                }


                await sock.sendMessage(jid, { 
                    text: verificationMsg.trim(), 
                    mentions: mentions 
                }, { quoted: newMsg });
            }
        };

        
        sock.ev.on('messages.upsert', listenerHandler);

        
        const timer = setTimeout(() => {
            sock.ev.off('messages.upsert', listenerHandler);
            activeListeners.delete(jid);
        }, 69000);

        
        activeListeners.set(jid, { handler: listenerHandler, timer });

    } catch (err) {
        console.error("❌ خطأ في أمر عدد:", err);
        await sock.sendMessage(jid, { text: "حدث خطأ أثناء الحساب." }, { quoted: msg });
    }
}

export const AstaPlugin = {
    command: "عدد",
    description: "يعرض العدد الحقيقي بعد التحقق من واتساب",
    elite: "off",
    group: false,
    prv: false,
    lock: "off",
    dev: "on"
};

export default { AstaPlugin, execute };
