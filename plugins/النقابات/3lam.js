import fs from "fs";
import path from "path";

const AstaPlugin = Object.freeze({
  command: ["علم"],
  description: "فعالية تخمين اسم العلم",
  elite: "off",
  group: false,
  prv: false,
  lock: "off",
  dev: "off",
  asta: "on"
});

const recentFlags = [];
const MAX_HISTORY = 30;

const wordList = [
  { flag: "🇪🇬", names: ["مصر", "egypt"] },
  { flag: "🇸🇦", names: ["السعودية", "saudi", "ksa"] },
  { flag: "🇦🇪", names: ["الإمارات", "uae", "emirates"] },
  { flag: "🇰🇼", names: ["الكويت", "كويت"] },
  { flag: "🇶🇦", names: ["قطر", "qatar"] },
  { flag: "🇧🇭", names: ["البحرين", "بحرين"] },
  { flag: "🇴🇲", names: ["عمان", "oman"] },
  { flag: "🇯🇴", names: ["الأردن", "اردن"] },
  { flag: "🇱🇧", names: ["لبنان", "lebanon"] },
  { flag: "🇵🇸", names: ["فلسطين", "palestine"] },
  { flag: "🇸🇾", names: ["سوريا", "syria"] },
  { flag: "🇮🇶", names: ["العراق", "عراق"] },
  { flag: "🇲🇦", names: ["المغرب", "مغرب"] },
  { flag: "🇩🇿", names: ["الجزائر", "جزائر"] },
  { flag: "🇹🇳", names: ["تونس", "tunisia"] },
  { flag: "🇱🇾", names: ["ليبيا", "libya"] },
  { flag: "🇸🇩", names: ["السودان", "سودان"] },
  { flag: "🇾🇪", names: ["اليمن", "يمن"] },
  { flag: "🇺🇸", names: ["امريكا", "usa", "america"] },
  { flag: "🇬🇧", names: ["بريطانيا", "uk", "england"] },
  { flag: "🇫🇷", names: ["فرنسا", "france"] },
  { flag: "🇩🇪", names: ["المانيا", "germany"] },
  { flag: "🇮🇹", names: ["ايطاليا", "italy"] },
  { flag: "🇪🇸", names: ["اسبانيا", "spain"] },
  { flag: "🇯🇵", names: ["اليابان", "يابان"] },
  { flag: "🇨🇳", names: ["الصين", "صين"] },
  { flag: "🇷🇺", names: ["روسيا", "russia"] },
  { flag: "🇨🇦", names: ["كندا", "canada"] },
  { flag: "🇧🇷", names: ["البرازيل", "برازيل"] },
  { flag: "🇦🇷", names: ["الأرجنتين", "ارجنتين"] },
  { flag: "🇹🇷", names: ["تركيا", "turkey"] },
  { flag: "🇰🇷", names: ["كوريا", "korea"] },
  { flag: "🇮🇳", names: ["الهند", "هند"] },
  { flag: "🇦🇺", names: ["استراليا", "australia"] },
  { flag: "🇲🇽", names: ["المكسيك", "مكسيك"] },
  { flag: "🇵🇹", names: ["البرتغال", "برتغال"] },
  { flag: "🇳🇱", names: ["هولندا", "netherlands"] },
  { flag: "🇧🇪", names: ["بلجيكا", "belgium"] },
  { flag: "🇨🇭", names: ["سويسرا", "switzerland"] },
  { flag: "🇸🇪", names: ["السويد", "سويد"] },
  { flag: "🇬🇷", names: ["اليونان", "يونان"] },
  { flag: "🇳🇴", names: ["النرويج", "نرويج"] },
  { flag: "🇩🇰", names: ["الدنمارك", "دنمارك"] },
  { flag: "🇫🇮", names: ["فنلندا", "finland"] },
  { flag: "🇦🇹", names: ["النمسا", "نمسا"] },
  { flag: "🇮🇪", names: ["ايرلندا", "ireland"] },
  { flag: "🇿🇦", names: ["جنوب افريقيا", "south africa"] },
  { flag: "🇳🇬", names: ["نيجيريا", "nigeria"] },
  { flag: "🇸🇳", names: ["السنغال", "سنغال"] },
  { flag: "🇮🇩", names: ["اندونيسيا", "اندونسيا"] },
  { flag: "🇲🇾", names: ["ماليزيا", "malaysia"] },
  { flag: "🇵🇰", names: ["باكستان", "pakistan"] },
  { flag: "🇮🇷", names: ["ايران", "iran"] },
  { flag: "🇨🇱", names: ["تشيلي", "chile"] },
  { flag: "🇨🇴", names: ["كولومبيا", "colombia"] },
  { flag: "🇭🇷", names: ["كرواتيا", "croatia"] },
  { flag: "🇺🇦", names: ["اوكرانيا", "ukraine"] },
  { flag: "🇻🇳", names: ["فيتنام", "vietnam"] }
];

const activeGames = new Map();

function normalize(text) {
  if (!text) return "";
  return text.toLowerCase()
    .trim()
    .replace(/[أآإ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[^a-zA-Z\u0600-\u06FF]/g, ""); 
    }

async function execute({ sock, msg }) {
  const chatId = msg.key.remoteJid;

  
  if (activeGames.has(chatId)) {
    return sock.sendMessage(chatId, {
      text: `*⚠️ في فعالية شغالة بالفعل استنى تخلص*`
    }, { quoted: msg });
  }

  
let available = wordList.filter(w => !recentFlags.includes(w.flag));


if (available.length === 0) {
  available = wordList;
  recentFlags.length = 0; 
}


const random = available[Math.floor(Math.random() * available.length)];


recentFlags.push(random.flag);


if (recentFlags.length > MAX_HISTORY) {
  recentFlags.shift();
}
  const answers = random.names.map(a => normalize(a));

const stopGame = (id) => {
  const game = activeGames.get(id);

  if (!game) return;

  try {
    if (game.timeoutId) {
      clearTimeout(game.timeoutId);
    }

    if (game.handler) {
      sock.ev.off("messages.upsert", game.handler);
    }
  } catch (e) {
    console.log(e);
  }

  activeGames.delete(id);
};

  
  await sock.sendMessage(chatId, {
    text: `*❊┇━━─≪•◦🕸◦•≫─━━┇❊*
*「🏳️┊فعالية اسم العلم┊🏳️」*
*يقوم المقدم باختيار علم و اول من يكتب اسم العلم هو الفائز*
*❊┇━━─≪•◦🕸◦•≫─━━┇❊*

*✯ ❕العلم╎↫ ⟨ ${random.flag} ⟩*

*✯ 💻 المسؤول╎↫ ⟨ اسـ🩸ــتـا ⟩*

*❊┇━━─≪•◦🕸◦•≫─━━┇❊*
*_⸙ تـوقـ🖊️ـيـع⤦𝐃𝐊𝐓_*
*_【𝑱. 𝑨. 𝑭. 𝑻◈|🕸|◈𝑬𝑺𝑷𝑨𝑫𝑨】🝳_*`
  }, { quoted: msg });

  
  const timeoutId = setTimeout(async () => {
    if (activeGames.has(chatId)) {
      await sock.sendMessage(chatId, {
        text: `*🕸════༺⏰༻════🕸*
*𖡧┇ انتهى الوقت ┇𖡧*

*✦ العلم 〔 ${random.flag} 〕*

*✦ الإجابة 〔 ${random.names[0]} 〕*

*🕸════༺⏰༻════*`
      });
      stopGame(chatId);
    }
  }, 30000);

  const messageHandler = async ({ messages }) => {
  const m = messages[0];

  if (!m.message || m.key.remoteJid !== chatId) return;

  const body =
    m.message.conversation ||
    m.message.extendedTextMessage?.text ||
    "";

  const userInput = normalize(body);

  if (!userInput) return;

  
  if (userInput === "استسلام") {
    clearTimeout(timeoutId);

    await sock.sendMessage(chatId, {
      text: `*❌ تم إنهاء الفعالية*\n\n*🏳️ الإجابة كانت : ${random.names[0]}*`
    });

    return stopGame(chatId);
  }

  
  if (answers.includes(userInput)) {

    clearTimeout(timeoutId);

    const winner = m.key.participant || m.key.remoteJid;

    await sock.sendMessage(chatId, {
      text: `*🕸════༺🎉༻════🕸*
*𖡧┇ ✅ إنتهت الفعالية ✅️ ┇𖡧*

*✦ العلم 〔 ${random.flag} / ${random.names[0]} 〕*

*✦ الفائز 〔 @${winner.split("@")[0]} 〕*

*✦ الجائزة 〔 1b 🫐 〕*

*🕸════༺🎉༻════🕸*`,
      mentions: [winner]
    }, { quoted: m });

    return stopGame(chatId);
  }
};


const oldGame = activeGames.get(chatId);

if (oldGame?.handler) {
  sock.ev.off("messages.upsert", oldGame.handler);
}


activeGames.set(chatId, {
  handler: messageHandler,
  timeoutId
});

sock.ev.on("messages.upsert", messageHandler);
}
export default { AstaPlugin, execute };