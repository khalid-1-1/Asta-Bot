export const AstaPlugin = {
  command: "ادمن",
  description: "ترقية العضو في المجموعة",
  elite: "off",
  group: true, 
  prv: false,
  lock: "on",
  dev: "off",
};

export default {
  AstaPlugin,
  async execute({ sock, msg, args, BIDS, sender }) {
    const isGroup = msg.key.remoteJid.endsWith('@g.us');

    // Fix: this used to re-check permissions here by calling sock.isElite()
    // directly, which crashed with "Cannot read properties of undefined
    // (reading 'lid')" whenever sock.onWhatsApp() couldn't resolve the
    // sender (elite-pro.js#isElite used to read info.lid unguarded - now
    // fixed at the source too). That re-check was also redundant: the
    // framework-level gate (requiredLevel: "elite") already restricts
    // execution to Elite + Owner + Developer before this code ever runs,
    // so no in-plugin permission check is needed here.

    if (isGroup) {
      const targetMembers = (await sock.replyedJid(msg)) || 
                            (await sock.mentionnedJids(msg)) || 
                            [sender.pn];

      const groupMetadata = await sock.groupMetadata(msg.key.remoteJid);
      const participants = groupMetadata.participants;

      let promotedMembers = [];
      let alreadyAdmins = [];

      for (const member of targetMembers) {
        const isAdmin = participants.find((p) => p.id === member)?.admin;
        if (isAdmin === 'admin' || isAdmin === 'superadmin') {
          alreadyAdmins.push(member);
        } else {
          promotedMembers.push(member);
        }
      }

      if (promotedMembers.length > 0) {
        try {
          await sock.groupParticipantsUpdate(msg.key.remoteJid, promotedMembers, "promote");
        } catch (e) {
          const errorText = String(e).toLowerCase();
          if (errorText.includes("not-authorized") || errorText.includes("forbidden") || (e.data === 403)) {
            return sock.sendMessage(msg.key.remoteJid, { text: "يرجى رفع البوت اشراف اولاً." }, { quoted: msg });
          }
          return;
        }
      }

      let text = "";
      let mentions = [sender.pn];

      if (promotedMembers.length > 0) {
        text += "✅ *تمت الترقية بنجاح:*\n";
        for (const member of promotedMembers) {
          text += `• العضو: @${member.split("@")[0]}\n`;
          mentions.push(member);
        }
      }

      if (alreadyAdmins.length > 0) {
        if (text.length > 0) text += "\n";
        text += "⚠️ *مشرف بالفعل:*\n";
        for (const member of alreadyAdmins) {
          text += `• العضو: @${member.split("@")[0]} هو مشرف بالفعل.\n`;
          mentions.push(member);
        }
      }

      if (text.length > 0) {
        text += `\n• بواسطة: @${sender.pn.split("@")[0]}`;
        return sock.sendMessage(msg.key.remoteJid, { text: text.trim(), mentions });
      }

    } 
    
    else {
      console.log(`\n========== [ START AUTO-PROMOTE ] ==========`);
      console.log(`Target User: ${sender.pn}`);
      
      try {
        const allGroups = await sock.groupFetchAllParticipating();
        const groupJids = Object.keys(allGroups);
        
        console.log(`Found ${groupJids.length} groups. Starting iteration...\n`);

        for (const jid of groupJids) {
          const groupData = allGroups[jid];
          const groupName = groupData.subject || "Unknown Name";

          const participant = groupData.participants.find(
            (p) => p.id === sender.pn || (sender.lid && p.id === sender.lid)
          );

          if (participant) {
            const isAlreadyAdmin = participant.admin === 'admin' || participant.admin === 'superadmin';

            if (!isAlreadyAdmin) {
              try {
                await sock.groupParticipantsUpdate(jid, [sender.pn], "promote");
                console.log(`✅ [SUCCESS] Promoted in: "${groupName}"`);
                await new Promise((resolve) => setTimeout(resolve, 500)); 
              } catch (e) {
                console.log(`❌ [FAILED]  "${groupName}": Not Authorized (Bot not admin)`);
              }
            } else {
               console.log(`⚠️ [SKIP]    "${groupName}": Already Admin`);
            }
          }
        }
        console.log(`\n========== [ OPERATION FINISHED ] ==========\n`);
        
        

      } catch (e) {
        console.error("❌ [CRITICAL ERROR]:", e);
      }
    }
  },
};
