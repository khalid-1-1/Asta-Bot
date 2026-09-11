import fs from "fs";
import path from "path";

const AstaPlugin = Object.freeze({
  command: ["اعلام"],
  description: "فعالية ايموجي الأعلام",
  elite: "off",
  group: false,
  prv: false,
  lock: "off",
  dev: "off",
  asta: "on"
});

const wordList = [
  "🇦🇫", "🇦🇱", "🇩🇿", "🇦🇸", "🇦🇩", "🇦🇴", "🇦🇮", "🇦🇶", "🇦🇬", "🇦🇷", "🇦🇲", "🇦🇼", "🇦🇺", "🇦🇹", "🇦🇿", "🇧🇸", "🇧🇭", "🇧🇩", "🇧🇧", "🇧🇾", "🇧🇪", "🇧🇿", "🇧🇯", "🇧🇲", "🇧🇹", "🇧🇴", "🇧🇦", "🇧🇼", "🇧🇷", "🇮🇴", "🇻🇬", "🇧🇳", "🇧🇬", "🇧🇫", "🇧🇮", "🇰🇭", "🇨🇲", "🇨🇦", "🇮🇨", "🇨🇻", "🇧🇶", "🇰🇾", "🇨🇫", "🇹🇩", "🇨🇱", "🇨🇳", "🇨🇽", "🇨🇨", "🇨🇴", "🇰🇲", "🇨🇬", "🇨🇩", "🇨🇰", "🇨🇷", "🇨🇮", "🇭🇷", "🇨🇺", "🇨🇼", "🇨🇾", "🇨🇿", "🇩🇰", "🇩🇯", "🇩🇲", "🇩🇴", "🇪🇨", "🇪🇬", "🇸🇻", "🇬🇶", "🇪🇷", "🇪🇪", "🇪🇹", "🇪🇺", "🇫🇰", "🇫🇴", "🇫🇯", "🇫🇮", "🇫🇷", "🇬🇫", "🇵🇫", "🇹🇫", "🇬🇦", "🇬🇲", "🇬🇪", "🇩🇪", "🇬🇭", "🇬🇮", "🇬🇷", "🇬🇱", "🇬🇩", "🇬🇵", "🇬🇺", "🇬🇹", "🇬🇬", "🇬🇳", "🇬🇼", "🇬🇾", "🇭🇹", "🇭🇳", "🇭🇰", "🇭🇺", "🇮🇸", "🇮🇳", "🇮🇩", "🇮🇷", "🇮🇶", "🇮🇪", "🇮🇲", "🇮🇹", "🇯🇲", "🇯🇵", "🇯🇪", "🇯🇴", "🇰🇿", "🇰🇪", "🇰🇮", "🇽🇰", "🇰🇼", "🇰🇬", "🇱🇦", "🇱🇻", "🇱🇧", "🇱🇸", "🇱🇷", "🇱🇾", "🇱🇮", "🇱🇹", "🇱🇺", "🇲🇴", "🇲🇰", "🇲🇬", "🇲🇼", "🇲🇾", "🇲🇻", "🇲🇱", "🇲🇹", "🇲🇭", "🇲🇶", "🇲🇷", "🇲🇺", "🇾🇹", "🇲🇽", "🇫🇲", "🇲🇩", "🇲🇨", "🇲🇳", "🇲🇪", "🇲🇸", "🇲🇦", "🇲🇿", "🇲🇲", "🇳🇦", "🇳🇷", "🇳🇵", "🇳🇱", "🇳🇨", "🇳🇿", "🇳🇮", "🇳🇪", "🇳🇬", "🇳🇺", "🇳🇫", "🇰🇵", "🇲🇵", "🇳🇴", "🇴🇲", "🇵🇰", "🇵🇼", "🇵🇸", "🇵🇦", "🇵🇬", "🇵🇾", "🇵🇪", "🇵🇭", "🇵🇳", "🇵🇱", "🇵🇹", "🇵🇷", "🇶🇦", "🇷🇪", "🇷🇴", "🇷🇺", "🇷🇼", "🇼🇸", "🇸🇲", "🇸🇹", "🇸🇦", "🇸🇳", "🇷🇸", "🇸🇨", "🇸🇱", "🇸🇬", "🇸🇽", "🇸🇰", "🇸🇮", "🇬🇸", "🇸🇧", "🇸🇴", "🇿🇦", "🇰🇷", "🇸🇸", "🇪🇸", "🇱🇰", "🇧🇱", "🇸🇭", "🇰🇳", "🇱🇨", "🇵🇲", "🇻🇨", "🇸🇩", "🇸🇷", "🇸🇿", "🇸🇪", "🇨🇭", "🇸🇾", "🇹🇼", "🇹🇯", "🇹🇿", "🇹🇭", "🇹🇱", "🇹🇬", "🇹🇰", "🇹🇴", "🇹🇹", "🇹🇳", "🇹🇷", "🇹🇲", "🇹🇨", "🇹🇻", "🇻🇮", "🇺🇬", "🇺🇦", "🇦🇪", "🇬🇧", "🇺🇸", "🇺🇾", "🇺🇿", "🇻🇺", "🇻🇦", "🇻🇪", "🇻🇳", "🇼🇫", "🇪🇭", "🇾🇪", "🇿🇲", "🇿🇼", "🏴󠁧󠁢󠁥󠁮󠁧󠁿", "🏴󠁧󠁢󠁳󠁣󠁴󠁿", "🏴󠁧󠁢󠁷󠁬󠁳󠁿", "🏳️‍⚧️", "🏴‍☠️"
];

const activeGames = new Map();

function normalize(text) {
  return text.toLowerCase().trim();
}

function splitWord(word) {
  return normalize(word).split('').join(' ');
}

async function execute({ sock, msg }) {
  const chatId = msg.key.remoteJid;

  if (activeGames.has(chatId)) {
    return sock.sendMessage(chatId, {
      text: "*⚠️ في فعالية شغالة بالفعل استنى تخلص*"
    }, { quoted: msg });
  }

  const word = wordList[Math.floor(Math.random() * wordList.length)];
  const answer = normalize(word);

  await sock.sendMessage(chatId, {
    text: `*❊┇━━─≪•◦🕸◦•≫─━━┇❊*
*「🚩┊فعالية العلم┊🚩」*
*يقوم المقدم باختيار علم و اول من يرسل العلم هو الفائز*
*❊┇━━─≪•◦🕸◦•≫─━━┇❊*

*✯ ❕العلم╎↫ ⟨ ${word} ⟩*

*✯ 💻 المسؤول╎↫ ⟨ اسـ🩸ــتـا ⟩*

*❊┇━━─≪•◦🕸◦•≫─━━┇❊*
*_⸙ تـوقـ🖊️ـيـع⤦𝐃𝐊𝐓_*
*_【𝑱. 𝑨. 𝑭. 𝑻◈|🕸|◈𝑬𝑺𝑷𝑨𝑫𝑨】🝳_*`
  }, { quoted: msg });

  activeGames.set(chatId, {
    answer,
    original: word,
    answered: false
  });

  const listener = async ({ messages }) => {
    const m = messages[0];
    if (!m.message) return;

    const from = m.key.remoteJid;
    if (from !== chatId) return;

    const body =
      m.message.conversation ||
      m.message.extendedTextMessage?.text ||
      "";

    const game = activeGames.get(chatId);
    if (!game || game.answered) return;

    if (normalize(body) === game.answer) {
      const winner = m.key.participant || m.key.remoteJid;

      activeGames.set(chatId, { ...game, answered: true });

      await sock.sendMessage(chatId, {
        text: `*🕸════༺🎉༻════🕸*
*𖡧┇ ✅ إنتهت الفعالية ✅️ ┇𖡧*

*✦ العلم 〔 ${word} 〕*

*✦ الفائز 〔 @${winner.split("@")[0]} 〕*

*✦ الجائزة 〔 1b 🫐 〕*

*🕸════༺🎉༻════🕸*`,
        mentions: [winner]
      });

      activeGames.delete(chatId);
      sock.ev.off("messages.upsert", listener);
    }

    if (normalize(body) === "استسلام") {
      await sock.sendMessage(chatId, {
        text: `*❌ تم الاستسلام*`
      });

      activeGames.delete(chatId);
      sock.ev.off("messages.upsert", listener);
    }
  };

  sock.ev.on("messages.upsert", listener);

  
  setTimeout(() => {
    const game = activeGames.get(chatId);
    if (game && !game.answered) {
      sock.sendMessage(chatId, {
        text: `*🕸════༺⏰༻════🕸*
        
*𖡧┇ انتهى الوقت ┇𖡧*

*🕸════༺⏰༻════*`
      });

      activeGames.delete(chatId);
      sock.ev.off("messages.upsert", listener);
    }
  }, 120000);
}

export default { AstaPlugin, execute };