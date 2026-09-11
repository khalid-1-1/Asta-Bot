const AstaPlugin = Object.freeze({
  command: "المطور",
  description: "عرض معلومات المطور",
  elite: "off",
  group: false,
  prv: false,
  lock: "off",
  dev: "off",
  asta: "on"
});

async function execute({ sock, msg }) {
  const from = msg.key.remoteJid;

  try {
    const message = `
━━━━━━━━━━━━━━━━━━━

📌 𝕎𝕖𝕝𝕔𝕠𝕞𝕖 𝕥𝕠 『 𝐀𝐒𝐓𝐀 』 𝔹𝕠𝕥 🩸

╔═══════════════════╗
║  🩸 𝔻𝕖𝕧𝕖𝕝𝕠𝕡𝕖𝕣 ℂ𝕒𝕣𝕕 🩸
╠═══════════════════╣
║ 🧾 ℕ𝕒𝕞𝕖 : 𝐊𝐇𝐀𝐋𝐈𝐃 👑 🩸
║ 🎭 𝔸𝕝𝕚𝕒𝕤  :『 𝐊𝐔𝐑𝐀𝐌𝐀 』🕷
║ 🎂 𝔸𝕘𝕖   : 𝐓𝐖𝐎 𝐍𝐔𝐌𝐁𝐄𝐑𝐒
║ 🗣️ ℚ𝕦𝕠𝕥𝕖 : 𝐍𝐎 𝐋𝐈𝐌𝐈𝐓𝐒 🕶
║ 💻 ℍ𝕠𝕓𝕓𝕪 : 𝐏𝐑𝐎𝐆𝐑𝐀𝐌𝐌𝐈𝐍𝐆 👨‍💻
║ 🏙️ 𝔸𝕕𝕕𝕣𝕖𝕤𝕤 : 𝐄𝐆𝐘𝐏𝐓 🇪🇬
╠═══════════════════╣
║ ⚠️ This number isn't a bot.
║ Don't send commands or you
║ will be blocked. 
╚═══════════════════╝

━━━━━━━━━━━━━━━━━━━
`.trim();

    
    await sock.sendMessage(from, {
      text: message
    }, { quoted: msg });

    
    const vcard = `
BEGIN:VCARD
VERSION:3.0
N:𝑲𝒉𝒂𝒍𝒊𝒅;𝑨𝒔𝒕𝒂;;;
FN:𝑲𝒉𝒂𝒍𝒊𝒅 | 𝑨𝒔𝒕𝒂
TEL;type=CELL;type=VOICE;waid=201094647840:+201094647840
ADR:;;Egypt;;;;
NOTE: هذا الرقم ليس بوت، لا ترسل أوامر وإلا سيتم حظرك 🫩
END:VCARD`.trim();

    await sock.sendMessage(from, {
      contacts: {
        displayName: "𝑲𝒉𝒂𝒍𝒊𝒅 | 𝑨𝒔𝒕𝒂",
        contacts: [{ vcard }]
      }
    }, { quoted: msg });

  } catch (error) {
    console.error("❌ خطأ:", error);
    await sock.sendMessage(from, {
      text: `❌ حصل خطأ:\n${error.message}`
    }, { quoted: msg });
  }
}

export default {
  AstaPlugin,
  execute
};