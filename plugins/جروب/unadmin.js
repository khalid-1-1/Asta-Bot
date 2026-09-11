import permissions from "../../handlers/permissions.js";

export const AstaPlugin = {
  command: "خفض",
  description: "إزالة الإشراف من عضو محدد.",
  elite: "off",
  group: true,
  prv: false,
  lock: "on",
  dev: "off",
};

export default {
  AstaPlugin,
  async execute({ sock, msg, args, BIDS, sender }) {
    // Fix: this used to re-check permissions here by calling sock.isElite()
    // directly, which crashed with "Cannot read properties of undefined
    // (reading 'lid')" whenever sock.onWhatsApp() couldn't resolve the
    // sender (elite-pro.js#isElite used to read info.lid unguarded - now
    // fixed at the source too). That re-check was also redundant: the
    // framework-level gate (requiredLevel: "elite") already restricts
    // execution to Elite + Owner + Developer before this code ever runs.

    const targetMembers = (await sock.replyedJid(msg)) ||
      (await sock.mentionnedJids(msg));

    if (!targetMembers && !args[0]) return;

    const targets = targetMembers || [sender.pn];

    // Central Owner/Developer protection: an Owner or Developer (hardcoded
    // OR dynamic) can never be a demote target, even if the person running
    // "خفض" is a Developer themselves - the executor's rank never overrides
    // this protection for the target.
    const { allowed: demotable, protected: protectedTargets } =
      permissions.splitProtectedTargets(targets);

    if (demotable.length === 0) {
      return sock.sendMessage(
        msg.key.remoteJid,
        {
          text: "🚫 لا يمكن تنفيذ هذا الإجراء على Owner أو Developer.",
          mentions: protectedTargets,
        },
        { quoted: msg }
      );
    }

    const groupMetadata = await sock.groupMetadata(msg.key.remoteJid);
    const participants = groupMetadata.participants;

    let demotedMembers = [];
    let notAdmins = [];

    for (const member of demotable) {
      const isAdmin = participants.find((p) => p.id === member)?.admin;

      if (isAdmin === 'admin' || isAdmin === 'superadmin') {
        demotedMembers.push(member);
      } else {
        notAdmins.push(member);
      }
    }

    if (demotedMembers.length > 0) {
      try {
        await sock.groupParticipantsUpdate(
          msg.key.remoteJid,
          demotedMembers,
          "demote"
        );
      } catch (e) {
        const errorText = String(e).toLowerCase();

        if (errorText.includes("not-authorized") || errorText.includes("forbidden") || (e.data === 403)) {
          return sock.sendMessage(
            msg.key.remoteJid,
            { text: "يرجى رفع البوت اشراف اولاً." },
            { quoted: msg }
          );
        }
        console.error("Error demoting member:", e);
        return;
      }
    }

    let text = "";
    let mentions = [sender.pn];

    if (demotedMembers.length > 0) {
      text += "✅ *تم الخفض بنجاح:*\n";
      for (const member of demotedMembers) {
        text += `• العضو: @${member.split("@")[0]}\n`;
        mentions.push(member);
      }
    }

    if (notAdmins.length > 0) {
      if (text.length > 0) text += "\n";
      text += "⚠️ *ليس مشرفاً:*\n";
      for (const member of notAdmins) {
        text += `• العضو: @${member.split("@")[0]} ليس مشرفاً بالفعل.\n`;
        mentions.push(member);
      }
    }

    if (protectedTargets.length > 0) {
      if (text.length > 0) text += "\n";
      text += "🚫 *محمي (Owner/Developer) - تم الاستثناء:*\n";
      for (const member of protectedTargets) {
        text += `• العضو: @${member.split("@")[0]}\n`;
        mentions.push(member);
      }
    }

    if (text.length > 0) {
      text += `\n• بواسطة: @${sender.pn.split("@")[0]}`;
      return sock.sendMessage(msg.key.remoteJid, {
        text: text.trim(),
        mentions,
      });
    }
  },
};
