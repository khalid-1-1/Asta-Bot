import { jidDecode } from "@whiskeysockets/baileys";

const timers = new Map();

const normalizeJid = (jid) => {
  if (!jid) return jid;

  if (jid.includes("@lid")) {
    const decode = jidDecode(jid);
    if (decode?.user) return decode.user + "@s.whatsapp.net";
  }

  return jid;
};

export const AstaPlugin = {
  command: ["timer","stopall","stop","timerlist"],
  description: "نظام مؤقتات متعدد و متقدم",
  elite: "off",
  group: false,
  prv: false,
  lock: "on",
  dev: "off",
};

export default {
  AstaPlugin,

  async execute({ sock, msg }) {

    const chatId = msg.key.remoteJid;

    const body =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      "";

    const args = body.trim().split(" ");
    const cmd = args[0].replace(/^\.{1,2}/,"").toLowerCase();

    const chatTimers = timers.get(chatId) || [];

    const formatTime = (sec)=>{
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = sec % 60;
      return `${h}h ${m}m ${s}s`;
    };

    

    if (cmd === "timerlist") {

      if (!chatTimers.length) {
        return sock.sendMessage(chatId,{
          text:"❌ لا توجد مؤقتات تعمل."
        },{ quoted: msg });
      }

      let text = "📊 المؤقتات الحالية:\n\n";

      chatTimers.forEach(t=>{
        text += `#${t.id} ⏳ ${formatTime(t.remaining)}\n📌 ${t.reason}\n\n`;
      });

      return sock.sendMessage(chatId,{
        text
      },{ quoted: msg });
    }

    

    if (cmd === "stopall") {

      if (!chatTimers.length) {
        return sock.sendMessage(chatId,{
          text:"❌ لا توجد مؤقتات."
        },{ quoted: msg });
      }

      chatTimers.forEach(t => clearInterval(t.interval));
      timers.delete(chatId);

      return sock.sendMessage(chatId,{
        text:"🛑 تم إيقاف كل المؤقتات."
      },{ quoted: msg });
    }

    

    if (cmd === "stop") {

      const id = parseInt(args[1]);

      if (!id) {
        return sock.sendMessage(chatId,{
          text:"❌ مثال: stop 1"
        },{ quoted: msg });
      }

      const timer = chatTimers.find(t => t.id === id);

      if (!timer) {
        return sock.sendMessage(chatId,{
          text:"❌ المؤقت غير موجود."
        },{ quoted: msg });
      }

      clearInterval(timer.interval);

      timers.set(chatId, chatTimers.filter(t => t.id !== id));

      return sock.sendMessage(chatId,{
        text:`🛑 تم إيقاف المؤقت رقم ${id}`
      },{ quoted: msg });
    }

    

    if (cmd === "timer") {

      const timeInput = args[1];

      if (!timeInput) {

        return sock.sendMessage(chatId,{
text:`❌ طريقة استخدام المؤقت:

⏱ مؤقت بمدة:
timer 30s
timer 5m مذاكرة
timer 1h تمرين

📊 عرض المؤقتات:
timerlist

🛑 إيقاف مؤقت:
stop 1

🛑 إيقاف كل المؤقتات:
stopall`
        },{ quoted: msg });
      }

      let seconds = 0;
      const value = parseInt(timeInput);

      if (timeInput.endsWith("s")) seconds = value;
      else if (timeInput.endsWith("m")) seconds = value * 60;
      else if (timeInput.endsWith("h")) seconds = value * 3600;

      if (!seconds || seconds <= 0) {
        return sock.sendMessage(chatId,{
          text:"❌ الوقت غير صالح."
        },{ quoted: msg });
      }

      const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
      const user = normalizeJid(mentioned[0]);

      const reason = args.slice(2).join(" ") || "بدون سبب";

      const id = chatTimers.length ? chatTimers[chatTimers.length-1].id + 1 : 1;

      let remaining = seconds;

      let sentMsg = await sock.sendMessage(chatId,{
        text:`⏳ المؤقت #${id} بدأ\n⏱ ${formatTime(remaining)}\n📌 ${reason}`,
        mentions: user ? [user] : []
      },{ quoted: msg });

      const interval = setInterval(async ()=>{

        remaining--;

        const timer = timers.get(chatId)?.find(t => t.id === id);
        if (timer) timer.remaining = remaining;

        if (remaining <= 0){

          clearInterval(interval);

          timers.set(chatId, timers.get(chatId).filter(t => t.id !== id));

          return sock.sendMessage(chatId,{
            text:`⏰ انتهى المؤقت #${id}\n📌 ${reason}`,
            mentions: user ? [user] : []
          },{ quoted: msg });
        }

        await sock.sendMessage(chatId,{
          text:`⏳ #${id} المتبقي: ${formatTime(remaining)}`,
          edit: sentMsg.key
        }).catch(()=>{});

      },1000);

      chatTimers.push({
        id,
        interval,
        remaining,
        reason
      });

      timers.set(chatId, chatTimers);

    }

  }
};