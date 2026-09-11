import fs from "fs";
import path from "path";
import { writeFile, mkdir } from "fs/promises";
import { downloadContentFromMessage } from "@whiskeysockets/baileys";

export const AstaPlugin = {
  command: "toimg",
  description: "تحويل الاستيكر إلى صورة",
  elite: "off",
  group: false,
  prv: false,
  lock: "off",
  dev: "off",
};

export default {
  AstaPlugin,

  async execute({ sock, msg }) {
    try {

      const chatId = msg.key.remoteJid;

      const sticker =
        msg.message?.stickerMessage ||
        msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.stickerMessage;

      if (!sticker) {
        return sock.sendMessage(chatId, {
          text: "❌ أرسل الأمر مع استيكر أو رد على استيكر."
        }, { quoted: msg });
      }

      const stream = await downloadContentFromMessage(sticker, "sticker");

      let buffer = Buffer.from([]);

      for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
      }

      const tempDir = "/sdcard/.bot/bot/temp";

      if (!fs.existsSync(tempDir)) {
        await mkdir(tempDir, { recursive: true });
      }

      const filePath = path.join(tempDir, `sticker_${Date.now()}.jpg`);

      await writeFile(filePath, buffer);

      await sock.sendMessage(chatId, {
        image: buffer,
        caption: "🖼️ تم تحويل الملصق إلى صورة."
      }, { quoted: msg });

      fs.unlinkSync(filePath);

    } catch (error) {

      console.error("Sticker Convert Error:", error);

      await sock.sendMessage(msg.key.remoteJid, {
        text: "❌ حدث خطأ أثناء التحويل."
      }, { quoted: msg });

    }
  }
};