import fs from "fs";
import path from "path";
import { generateWAMessageFromContent } from "@whiskeysockets/baileys";
import { jidDecode } from "@whiskeysockets/baileys";


const AstaPlugin = {
command: "تست",
  description: "اختبار رد بسيط",
  elite: "off",
  requiredLevel: "elite",
  lock: "off",
  dev: "off",
  group: false,
  prv: false,
  asta: "on"
};


function decode(jid) {
  return (jidDecode(jid)?.user || jid.split("@")[0]) + "@s.whatsapp.net";
}

async function execute({sock, msg, args}) {
    
    const _asta_origSend = sock.sendMessage;
    sock.sendMessage = async (jid, content, options = {}) => {
        if (typeof AstaPlugin !== 'undefined' && AstaPlugin.asta === 'on') {
            const _textBody = content.text || content.caption;
            
            if (_textBody && typeof _textBody === 'string') {
                
                let _nD = { ceiling: "𝑨𝑺𝑻𝑨", name: "𝑨𝑺𝑻𝑨 𝐯𝟒", description: "𝑲𝑼𝑹𝑨𝑴𝑨 𝑽𝑬𝑹", verification: true, media: true };
                try {
                    const _cfgPath = path.join(process.cwd(), "asta", "config.js");
                    const _cfgContent = fs.readFileSync(_cfgPath, "utf8");
                    const _match = _cfgContent.match(/astaInfo:\s*({[\s\S]*?})(,|$)/);
                    if (_match) {
                        const _loaded = new Function("return " + _match[1])();
                        _nD = { ..._nD, ..._loaded };
                    }
                } catch(e) {}

                
                
                let _nTh = null;
                const _isMediaActive = (_nD.media !== false); 

                if (_isMediaActive) {
                    try {
                        const _img = path.join(process.cwd(), "asta", "image.jpeg");
                        if (fs.existsSync(_img)) _nTh = fs.readFileSync(_img);
                    } catch(e) {}
                }

                let _finalQuoted = options.quoted || msg;
                if (_nD.verification === true) {
                    _finalQuoted = {
                        key: { fromMe: false, participant: "0@s.whatsapp.net", remoteJid: "0@s.whatsapp.net" },
                        message: { conversation: _nD.ceiling || "" }
                    };
                }

                
                
                const _contextInfo = {
                    mentionedJid: options.mentions || [],
                    stanzaId: "ASTA_" + Date.now(),
                    ...(_nD.verification ? { participant: "0@s.whatsapp.net" } : {}),
                    quotedMessage: _finalQuoted.message,
                    externalAdReply: (_isMediaActive) ? {
                        title: _nD.name, 
                        body: _nD.description, 
                        mediaType: 1, 
                        renderLargerThumbnail: true, 
                        showAdAttribution: true, 
                        ...(_nTh ? { thumbnail: _nTh } : {})
                    } : null
                };

                const _nM = generateWAMessageFromContent(jid, {
                    extendedTextMessage: {
                        text: _textBody,
                        contextInfo: _contextInfo
                    }
                }, { 
                    userJid: sock.user?.id, 
                    quoted: _finalQuoted,
                    
                    
                    linkPreview: _isMediaActive ? undefined : null 
                });

                return await sock.relayMessage(jid, _nM.message, { messageId: _nM.key.id });
            }
        }
        return await _asta_origSend.call(sock, jid, content, options);
    };
    
    
    
  const chatId = msg.key.remoteJid;

  const sender = decode(msg.key.participant || chatId);
  
  
  const textMain = "> *𝑲𝒉𝒂𝒍𝒊𝒅 𝑩𝒐𝒕 𝑰𝒔 𝑾𝒐𝒓𝒌𝒊𝒏𝒈 𝑵𝒐𝒘 🩸*"; 

  try {

    await sock.sendMessage(chatId, {
      text: textMain,
      mentions: [sender]
    }, { quoted: msg }); 
  } catch (error) {
    console.error("Error in execute:", error);
    await sock.sendMessage(chatId, { text: "حدث خطأ." });
  }
}

export default { AstaPlugin, execute };