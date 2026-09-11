import { downloadContentFromMessage } from "@whiskeysockets/baileys";
import { exec } from "child_process";
import fs from "fs";
import path from "path";

export const AstaPlugin = {
  command: ["stick"],
  description: "تحويل صورة / فيديو / GIF إلى استيكر",
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

      const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

      if (!quoted) {
        return sock.sendMessage(msg.key.remoteJid,{
          text:"⚠️ رد على صورة أو فيديو أو GIF علشان تحوله لاستيكر"
        },{ quoted: msg });
      }

      const isImage = !!quoted.imageMessage;
      const isVideo = !!quoted.videoMessage;

      if (!isImage && !isVideo){
        return sock.sendMessage(msg.key.remoteJid,{
          text:"⚠️ لازم ترد على صورة أو فيديو أو GIF"
        },{ quoted: msg });
      }

      const type = isImage ? "image" : "video";

      const stream = await downloadContentFromMessage(
        quoted[type + "Message"],
        type
      );

      let buffer = Buffer.from([]);

      for await (const chunk of stream){
        buffer = Buffer.concat([buffer,chunk]);
      }

      if (!buffer.length){
        return sock.sendMessage(msg.key.remoteJid,{
          text:"❌ فشل تحميل الملف"
        },{ quoted: msg });
      }

      const tmpDir = "/sdcard/.temp_sticker";

      if (!fs.existsSync(tmpDir)){
        fs.mkdirSync(tmpDir,{ recursive:true });
      }

      const input = path.join(tmpDir,`input_${Date.now()}.${isVideo?"mp4":"jpg"}`);
      const output = path.join(tmpDir,`output_${Date.now()}.webp`);

      fs.writeFileSync(input,buffer);

      const ffmpeg = "/data/data/com.termux/files/usr/bin/ffmpeg";

      let cmd = "";

      if (isImage){

        cmd = `${ffmpeg} -y -i "${input}" -vf "crop='min(iw,ih)':'min(iw,ih)',scale=512:512" -vcodec libwebp -lossless 1 -preset picture -an -q:v 80 "${output}"`;

      }else{

        cmd = `${ffmpeg} -y -i "${input}" -vf "crop='min(iw,ih)':'min(iw,ih)',scale=512:512,fps=15" -loop 0 -t 10 -vcodec libwebp -preset default -lossless 0 -qscale 50 -an "${output}"`;

      }

      // Stage 9, item #8 (Process / Child Process Safety) - bounds how
      // long ffmpeg may run and how much stdout/stderr it may buffer
      // before being force-killed. The command itself is unchanged.
      exec(cmd, { timeout: 60_000, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024 }, async (err)=>{

        if (err){

          console.log("FFmpeg error:",err);

          return sock.sendMessage(msg.key.remoteJid,{
            text:"❌ فشل تحويل الوسائط"
          },{ quoted: msg });

        }

        if (!fs.existsSync(output)){
          return sock.sendMessage(msg.key.remoteJid,{
            text:"❌ لم يتم إنشاء الاستيكر"
          },{ quoted: msg });
        }

        const sticker = fs.readFileSync(output);

        await sock.sendMessage(msg.key.remoteJid,{
          sticker: sticker
        },{ quoted: msg });

        try{
          fs.unlinkSync(input);
          fs.unlinkSync(output);
        }catch{}

      });

    }catch(e){

      console.log(e);

      sock.sendMessage(msg.key.remoteJid,{
        text:"❌ حدث خطأ أثناء المعالجة"
      },{ quoted: msg });

    }

  }

};