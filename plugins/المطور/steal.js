import fs from "fs";
import { downloadContentFromMessage } from "@whiskeysockets/baileys";
import { exec } from "child_process";
import { promisify } from "util";

const execPromise = promisify(exec);

const GROUPS = {
   1: "120363424494855231@g.us", //asta
   2: "120363418431749105@g.us", //قرآن
   3: "120363419508210188@g.us", //اخواتي
};

const AstaPlugin = Object.freeze({
  command: "steal",
  description: "امر خاص بالـ Owner",
  elite: "off",
  group: false,
  prv: false,
  lock: "off",
  dev: "on",
  asta: "on"
});


async function execute({ sock, msg, args }) {
  const tempInput = `./temp/input_${Date.now()}.ogg`;
  const tempOutput = `./temp/output_${Date.now()}.opus`;

  try {
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const audioMsg = quoted?.audioMessage || quoted?.documentWithCaptionMessage?.message?.audioMessage;

    if (!audioMsg) {
      return await sock.sendMessage(msg.key.remoteJid, { text: "MISUSE ❌️" });
    }

    
    const stream = await downloadContentFromMessage(audioMsg, "audio");
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk]);
    }

    
    if (!fs.existsSync('./temp')) fs.mkdirSync('./temp');
    fs.writeFileSync(tempInput, buffer);

    
    // Stage 9, item #8 (Process / Child Process Safety).
    await execPromise(`ffmpeg -i ${tempInput} -c:a libopus -b:a 32k -vbr on ${tempOutput}`, { timeout: 60_000, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024 });

    
    let target = args[0] && GROUPS[args[0]] ? GROUPS[args[0]] : (msg.key.participant || msg.key.remoteJid);

    
    await sock.sendMessage(target, {
      audio: fs.readFileSync(tempOutput),
      mimetype: "audio/ogg; codecs=opus",
      ptt: true 
    });

    await sock.sendMessage(msg.key.remoteJid, { text: `DONE ✅️` });

  } catch (err) {
    console.error("Error in Steal Command:", err);
    await sock.sendMessage(msg.key.remoteJid, { text: "ERROR ❌️\n" + err.message });
  } finally {
    
    if (fs.existsSync(tempInput)) fs.unlinkSync(tempInput);
    if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);
  }
}

export { AstaPlugin, execute };
