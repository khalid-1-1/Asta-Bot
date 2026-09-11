import permissions from "../../handlers/permissions.js";

export const AstaPlugin = {
    command: "طرد",
    description: "طرد (إزالة) عضو محدد من المجموعة بصمت (حصري للنخبة).",
    elite: "off",
    group: true, 
    prv: false,
    lock: "on",
    dev: "off",
};

export default {
    AstaPlugin,
    async execute({ sock, msg, args, BIDS, sender }) {
        try {
            const chat = msg.key.remoteJid;
            

            const ctx = msg.message?.extendedTextMessage?.contextInfo;
            const mentioned = ctx?.mentionedJid?.[0]; 
            const replied = ctx?.participant; 
            
            let targetJID;

            if (mentioned) {
                targetJID = mentioned;
            } else if (replied) {
                targetJID = replied;
            } else if (args[0]) {
                
                const number = args[0].replace(/[^0-9]/g, "");
                if (number.length > 0) {
                    targetJID = number + "@s.whatsapp.net";
                }
            }

            if (!targetJID) {

                return;
            }


            const pure = targetJID.split('@')[0];
            const cleanJID = pure + "@s.whatsapp.net";


            const groupMetadata = await sock.groupMetadata(chat);
            

            const participant = groupMetadata.participants.find(p => 
                p.id.split('@')[0] === pure || p.id === cleanJID
            );

            if (!participant) {
               
                 return sock.sendMessage(chat, { text: "❌ العضو غير موجود في المجموعة." }, { quoted: msg });
            }

            // Central Owner/Developer protection: widened from
            // hardcoded-Developer-only to Owner (hardcoded or dynamic) +
            // Developer - a kick can never target either, even when the
            // executor is a Developer themselves.
            if (permissions.isProtectedTarget(participant.id)) {
                return;
            }

            await sock.groupParticipantsUpdate(chat, [participant.id], "remove");

        } catch (err) {
            console.error("❌ خطأ أثناء تنفيذ أمر الطرد الصامت (طرد):", err);

            if (String(err).includes('401') || String(err).includes('not a group admin')) {
                console.log("⚠️ البوت ليس مشرفاً لطرد العضو.");
            }
        }
    }
};
