export const AstaPlugin = {
  command: "لينك",
  description: "يعطي رابط دعوة المجموعة مع إمكانية إضافة رسالة",
  elite: "off",
  requiredLevel: "elite",
  group: true,
  prv: false,
  lock: "off",
  dev: "off",
};

export default {
  AstaPlugin,

  async execute({ sock, msg }) {

    const chatId = msg.key.remoteJid;

    if (!chatId.endsWith("@g.us")){
      return sock.sendMessage(chatId,{
        text:"❌ هذا الأمر يعمل فقط في المجموعات."
      },{ quoted: msg });
    }

    const body =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      "";

    let customMessage = body.split(/لينك/i)[1]?.trim() || "";

    try{

      const inviteCode = await sock.groupInviteCode(chatId);
      const inviteLink = `https://chat.whatsapp.com/${inviteCode}`;

     let finalText = `🔗 رابط الفرع
${inviteLink}`;

      await sock.sendMessage(chatId,{
        text: finalText
      },{ quoted: msg });

    }catch(error){

      await sock.sendMessage(chatId,{
        text:`❌ حدث خطأ أثناء جلب الرابط:\n${error.message}`
      },{ quoted: msg });

    }

  }
};