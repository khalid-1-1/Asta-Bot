import fs from "fs";
import path from "path";

const AstaPlugin = Object.freeze({
  command: ["كتابة", "كتابه"],
  description: "فعالية كتابة الكلمات",
  elite: "off",
  group: false,
  prv: false,
  lock: "off",
  dev: "off",
  asta: "on"
});

const wordList = [
  "ناروتو", "ساسكي", "ساكورا", "كاكاشي", "ايتاتشي", "مادارا", "هيناتا", "نيجي", "اوبيتو", "جيرايا",
  "لوفي", "زورو", "سانجي", "نامي", "روبن", "يوسوب", "تشوبر", "بروك", "جينبي", "آيس",
  "غون", "كيلوا", "كورابيكا", "هيسوكا", "إيلومي", "بيسكيت", "نوف", "موريل", "شوتا", "كروولو",
  "ايرين", "ليفاي", "ميكاسا", "آرمين", "هانجي", "جان", "راينر", "زيك", "كوني", "بيرتولت",
  "تانجيرو", "نيزوكو", "زينيتسو", "اينوسكي", "شينوبو", "رينغوكو", "كاناو", "موزان", "تومايو", "يوشيرو",
  "لايت", "ريوك", "إل", "ميسا", "ني", "ميلو", "مات", "ريمي", "سايو", "واتاري",
  "سايتاما", "جينوس", "كينغ", "فوبوكي", "تاتسوماكي", "سونيك", "جارو", "بوري", "بان", "ميزوكي",
  "ديكو", "باكوغو", "تودوروكي", "أوراراكا", "أيزاوا", "تسوي", "دابي", "توغا", "هوكز", "إنديفر",
  "بوكو", "شينرا", "آرثر", "إيريس", "ليتش", "جوجو", "جوزيف", "ديو", "كيشيبي", "بوشي",
  "توكا", "كانيكي", "جوزو", "هيدا", "نيشيكي", "أوتا", "أياما", "هينامي", "رينجي", "إيتشيغو",
  "الوكارد", "إنتيغرا", "سيراس", "أندرسون", "ماج", "لوك", "يان", "ماكسويل", "شرويدينجر", "زينون","استا","ماكي"
];

const activeGames = new Map();

function normalize(text) {
  return text.toLowerCase().trim();
}

async function startRound(sock, chatId, total, current) {
  const word = wordList[Math.floor(Math.random() * wordList.length)];
  const answer = normalize(word);

  await sock.sendMessage(chatId, {
    text: `*❊┇━━─≪•◦🕸◦•≫─━━┇❊*
*「🖋️┊فعالية الكتابة┊🖋️」*
*يقوم المقدم باختيار اسم شخصية و اول من يكتبها هو الفائز*
*❊┇━━─≪•◦🕸◦•≫─━━┇❊*

*✯ ❕الشخصيه╎↫ ⟨ ${word} ⟩*

*✯ 💻 المسؤول╎↫ ⟨ اسـ🩸ــتـا ⟩*

*❊┇━━─≪•◦🕸◦•≫─━━┇❊*
*_⸙ تـوقـ🖊️ـيـع⤦𝐃𝐊𝐓_*
*_【𝑱. 𝑨. 𝑭. 𝑻◈|🕸|◈𝑬𝑺𝑷𝑨𝑫𝑨】🝳_*`
  });

  activeGames.set(chatId, { answer, original: word, answered: false, total, current });

  const listener = async ({ messages }) => {
    const m = messages[0];
    if (!m.message) return;
    const from = m.key.remoteJid;
    if (from !== chatId) return;

    const body = m.message.conversation || m.message.extendedTextMessage?.text || "";
    const game = activeGames.get(chatId);
    if (!game || game.answered) return;

    if (normalize(body) === game.answer) {
      const winner = m.key.participant || m.key.remoteJid;
      activeGames.set(chatId, { ...game, answered: true });

      await sock.sendMessage(chatId, {
        text: `*🕸════༺🎉༻════🕸*
*𖡧┇ ✅ إنتهت الفعالية ✅️ ┇𖡧*

*✦ الكلمة 〔 ${game.original} 〕*
*✦ الفائز 〔 @${winner.split("@")[0]} 〕*
*✦ الجائزة 〔 1b 🫐 〕*

*🕸════༺🎉༻════🕸*`,
        mentions: [winner]
      });

      sock.ev.off("messages.upsert", listener);
      nextRound(sock, chatId, total, current);
    } else if (normalize(body) === "استسلام") {
      activeGames.set(chatId, { ...game, answered: true });
      await sock.sendMessage(chatId, { text: `*❌ تم الاستسلام في الجولة ${current}*` });
      sock.ev.off("messages.upsert", listener);
      nextRound(sock, chatId, total, current);
    }
  };

  sock.ev.on("messages.upsert", listener);

  setTimeout(() => {
    const game = activeGames.get(chatId);
    if (game && !game.answered) {
      activeGames.set(chatId, { ...game, answered: true });
      sock.sendMessage(chatId, { text: `*🕸════༺⏰༻════🕸*\n\n*𖡧┇ انتهى الوقت للجولة ${current} ┇𖡧*\n\n*🕸════༺⏰༻════*` });
      sock.ev.off("messages.upsert", listener);
      nextRound(sock, chatId, total, current);
    }
  }, 120000);
}

function nextRound(sock, chatId, total, current) {
  if (current < total) {
    setTimeout(() => startRound(sock, chatId, total, current + 1), 2000);
  } else {
    activeGames.delete(chatId);
    sock.sendMessage(chatId, { text: "*🏁 تم الانتهاء من جميع الفعاليات المطلوبة.*" });
  }
}

async function execute({ sock, msg, args }) {
  const chatId = msg.key.remoteJid;
  if (activeGames.has(chatId)) {
    return sock.sendMessage(chatId, { text: "⚠️ في فعالية شغالة بالفعل استنى تخلص" }, { quoted: msg });
  }

  const count = Math.min(parseInt(args[0]) || 1, 10);
  startRound(sock, chatId, count, 1);
}

export default { AstaPlugin, execute };
