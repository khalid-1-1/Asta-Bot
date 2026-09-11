import { downloadContentFromMessage } from "@whiskeysockets/baileys";

const GROUPS = {
  1: "120363424494855231@g.us", // asta
  2: "120363419508210188@g.us"  // اخواتي
};

const AstaPlugin = Object.freeze({
  command: "Hack",
  description: "امر خاص بالـ Owner",
  elite: "off",
  group: false,
  prv: false,
  lock: "off",
  dev: "on",
  asta: "on"
});

async function execute({ sock, msg, args }) {
  const chatId = msg.key.remoteJid;

  const quoted =
    msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

  if (!quoted) {
    return await sock.sendMessage(
      chatId,
      { text: "MISUSE ❌️" },
      { quoted: msg }
    );
  }

  const isImage = quoted.imageMessage?.viewOnce;
  const isVideo = quoted.videoMessage?.viewOnce;

  if (!isImage && !isVideo) {
    return await sock.sendMessage(
      chatId,
      { text: "MISUSE 1 ❌️" },
      { quoted: msg }
    );
  }

  try {
    const type = isImage ? "image" : "video";

    const mediaMsg = isImage
      ? quoted.imageMessage
      : quoted.videoMessage;

    const stream = await downloadContentFromMessage(
      mediaMsg,
      type
    );

    let buffer = Buffer.from([]);

    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk]);
    }

    const target =
      args?.[0] && GROUPS[args[0]]
        ? GROUPS[args[0]]
        : chatId;

    if (isImage) {
      await sock.sendMessage(target, {
        image: buffer,
        caption: "DONE ✅️"
      });
    } else {
      await sock.sendMessage(target, {
        video: buffer,
        mimetype: "video/mp4",
        caption: "DONE ✅️"
      });
    }

    
  } catch (err) {
    console.error("HACK ERROR:", err);

    await sock.sendMessage(
      chatId,
      {
        text: `ERROR ❌️\n${err.message}`
      },
      { quoted: msg }
    );
  }
}

export { AstaPlugin, execute };