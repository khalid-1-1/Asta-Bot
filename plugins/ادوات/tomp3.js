import { downloadContentFromMessage } from "@whiskeysockets/baileys";
import fs from "fs";
import path from "path";
import { exec } from "child_process";

export const AstaPlugin = {
  command: "tomp3",
  description: "تحويل الفيديو إلى صوت",
  elite: "off",
  group: false,
  prv: false,
  lock: "off",
  dev: "off",
};

export default {

  AstaPlugin,

  async execute({ sock, msg }) {

    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.videoMessage;

    if (!quoted){
      return sock.sendMessage(msg.key.remoteJid,{
        text:"📼 قم بالرد على فيديو لتحويله إلى صوت"
      },{ quoted: msg });
    }

    try{

      const stream = await downloadContentFromMessage(quoted,'video');

      let buffer = Buffer.from([]);

      for await (const chunk of stream){
        buffer = Buffer.concat([buffer,chunk]);
      }

      const input = path.join(process.cwd(),`video_${Date.now()}.mp4`);
      const output = path.join(process.cwd(),`audio_${Date.now()}.mp3`);

      fs.writeFileSync(input,buffer);

      // Stage 9, item #8 (Process / Child Process Safety) - bounds how
      // long ffmpeg may run and how much stdout/stderr it may buffer
      // before being force-killed. The command itself is unchanged.
      exec(`ffmpeg -i "${input}" -vn -acodec libmp3lame -q:a 2 "${output}"`, { timeout: 60_000, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024 }, async (err)=>{

        if (err){
          console.log(err);

          return sock.sendMessage(msg.key.remoteJid,{
            text:"❌ حدث خطأ أثناء التحويل"
          },{ quoted: msg });
        }

        const audio = fs.readFileSync(output);

        await sock.sendMessage(msg.key.remoteJid,{
          audio: audio,
          mimetype: "audio/mp4",
          ptt: false
        },{ quoted: msg });

        fs.unlinkSync(input);
        fs.unlinkSync(output);

      });

    }catch(e){

      console.log(e);

      sock.sendMessage(msg.key.remoteJid,{
        text:"❌ حدث خطأ أثناء معالجة الفيديو"
      },{ quoted: msg });

    }

  }

};