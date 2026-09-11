import { execFile } from "child_process";
import fs from "fs";
import path from "path";

export const AstaPlugin = {
  command: "تحميل",
  description: "تحميل فيديو أو صوت من يوتيوب، تيك توك، أو إنستغرام.",
  elite: "off",
  group: false,
  prv: false,
  lock: "off",
  dev: "off",
};

export default {
  AstaPlugin,

  async execute({ sock, msg, args }) {
    try {

      const chatId = msg.key.remoteJid;

      let commandText = msg.message?.extendedTextMessage?.text || "";

      if (commandText && commandText.startsWith("تحميل")) {
        const commandParts = commandText.split(" ");

        if (commandParts.length < 3) {
          return await sock.sendMessage(chatId,{
            text:"❌ الاستخدام : تحميل [فيديو|صوت] [الرابط]"
          },{ quoted: msg });
        }

        args = [
          commandParts[1].toLowerCase(),
          commandParts.slice(2).join(" ").trim()
        ];
      }

      if (!args || args.length < 2) {
        return await sock.sendMessage(chatId,{
          text:"❌ الاستخدام : تحميل [فيديو|صوت] [الرابط]"
        },{ quoted: msg });
      }

      const format = args[0].toLowerCase();
      const url = args[1].trim();

      if (!url.startsWith("http")) {
        return await sock.sendMessage(chatId,{
          text:"❌ الرابط غير صالح."
        },{ quoted: msg });
      }

      const timestamp = Date.now();
      const tempDir = "./temp";

      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir,{ recursive:true });
      }

      const videoPath = path.join(tempDir,`${timestamp}.mp4`);
      const audioPath = path.join(tempDir,`${timestamp}.mp3`);

      await sock.sendMessage(chatId,{
        text:"⏳ جاري التحميل..."
      },{ quoted: msg });

      const cleanupFile = (filePath)=>{
        if (fs.existsSync(filePath)){
          fs.unlink(filePath,(err)=>{
            if (err) console.error("❌ فشل حذف الملف:",err.message);
          });
        }
      };

      if (format === "فيديو"){

        // Stage 5, item #9 (Security Audit): `url` is raw user input and
        // was previously interpolated straight into a shell string passed
        // to exec() - a crafted link (e.g. containing `"; rm -rf ...` or
        // `$(...)`) would have run as an arbitrary shell command. execFile
        // with an argv array never invokes a shell, so the url is always
        // passed to yt-dlp as a single literal argument - same command,
        // same flags, no shell parsing of its content.
        // Stage 9, item #8 (Process / Child Process Safety) - yt-dlp downloads
        // can legitimately take a while, so this gets a longer timeout than
        // the ffmpeg conversions elsewhere, but it is still bounded rather
        // than able to run forever on a stalled/huge download.
        execFile("yt-dlp", ["-f", "best[ext=mp4]/best", "-o", videoPath, url], { timeout: 180_000, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024 }, async (err, stdout, stderr) => {

          console.log("STDOUT:", stdout);
          console.log("STDERR:", stderr);

          if (err || !fs.existsSync(videoPath)){
            cleanupFile(videoPath);
            return await sock.sendMessage(chatId,{
              text:"❌ فشل تحميل الفيديو."
            },{ quoted: msg });
          }

          try{

            await sock.sendMessage(chatId,{
              video: fs.readFileSync(videoPath),
              caption:`🎥 تم تحميل الفيديو`
            },{ quoted: msg });

          }catch(e){
            console.error(e);
          }finally{
            cleanupFile(videoPath);
          }

        });

      }else if (format === "صوت"){

        // Stage 9, item #8 (Process / Child Process Safety).
        execFile("yt-dlp", ["-x", "--audio-format", "mp3", "-o", audioPath, url], { timeout: 180_000, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024 }, async (err, stdout, stderr) => {

          console.log("STDOUT:", stdout);
          console.log("STDERR:", stderr);

          if (err || !fs.existsSync(audioPath)){
            cleanupFile(audioPath);
            return await sock.sendMessage(chatId,{
              text:"❌ فشل تحميل الصوت."
            },{ quoted: msg });
          }

          try{

            await sock.sendMessage(chatId,{
              audio: fs.readFileSync(audioPath),
mimetype: "audio/mpeg",
ptt: false
            },{ quoted: msg });

          }catch(e){
            console.error(e);
          }finally{
            cleanupFile(audioPath);
          }

        });

      }else{

        return await sock.sendMessage(chatId,{
          text:"❌ يجب تحديد النوع (فيديو أو صوت)."
        },{ quoted: msg });

      }

    } catch (error){

      console.error(error);

      await sock.sendMessage(msg.key.remoteJid,{
        text:`❌ حدث خطأ:\n${error.message}`
      },{ quoted: msg });

    }
  }
};
