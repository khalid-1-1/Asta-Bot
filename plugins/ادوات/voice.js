import fs from "fs";
import axios from "axios";
import path from "path";
import { pipeline } from "stream/promises";
import { exec } from "child_process";
import { promisify } from "util";

const execPromise = promisify(exec);

const AstaPlugin = Object.freeze({
  command: "انطق",
  description: "تحويل النص إلى صوت عربي وإنجليزي مدمج",
  elite: "off",
  group: false,
  prv: false,
  lock: "off",
  dev: "off",
  asta: "on"
});

async function execute({ sock, msg }) {
  const chatId = msg.key.remoteJid;
  const timestamp = Date.now();
  const tempMp3 = path.join(process.cwd(), `temp_${timestamp}.mp3`);
  const finalOpus = path.join(process.cwd(), `man_${timestamp}.opus`);

  try {
    const body = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";
    const content = body.replace(/^انطق\s*/i, "").trim();

    if (!content) return;

    const isArabic = /[\u0600-\u06FF]/.test(content);
    const lang = isArabic ? "ar" : "en";

    await sock.sendMessage(chatId, { react: { text: "🎙️", key: msg.key } });


    const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(content)}&tl=${lang}&client=tw-ob`;
    const res = await axios({ method: "GET", url: ttsUrl, responseType: "stream" });
    await pipeline(res.data, fs.createWriteStream(tempMp3));

    // Stage 9, item #8 (Process / Child Process Safety).
    await execPromise(`ffmpeg -i ${tempMp3} -af "asetrate=44100*0.8,atempo=1.1" -c:a libopus ${finalOpus}`, { timeout: 60_000, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024 });


    const audioBuffer = fs.readFileSync(finalOpus);
    await sock.sendMessage(chatId, { 
      audio: audioBuffer, 
      mimetype: "audio/ogg; codecs=opus", 
      ptt: true 
    }, { quoted: msg });

  } catch (err) {
    console.error(err);
  } finally {

    [tempMp3, finalOpus].forEach(p => { if (fs.existsSync(p)) fs.unlinkSync(p); });
  }
}

export default { AstaPlugin, execute };