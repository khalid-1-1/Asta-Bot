import { generateWAMessageFromContent } from "@whiskeysockets/baileys";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { jidDecode } from "@whiskeysockets/baileys";
import developer from "../../handlers/developer.js";
import menuData from "../../handlers/menuData.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const activeMenuSessions = new Map();

const AstaPlugin = {
command: "اوامر", 
  description: "قائمة الأوامر التفاعلية — Asta",
  group: false,
  prv: false,  
  elite: "off",
  lock: "off",
  dev: "off",
  asta: "on"
};

function decode(jid) {
  return (jidDecode(jid)?.user || jid.split("@")[0]) + "@s.whatsapp.net";
}

async function execute({ sock, msg, args, sender }) {
    
    const _asta_origSend = sock.sendMessage;
    sock.sendMessage = async (jid, content, options = {}) => {
        if (typeof AstaPlugin !== 'undefined' && AstaPlugin.asta === 'on') {
            const _textBody = content.text || content.caption;
            
            if (_textBody && typeof _textBody === 'string') {
                
                let _nD = { ceiling: "𝑨𝒔𝒕𝒂", name: "𝐀𝐒𝐓𝐀 𝐯𝟒", description: "𝑲𝑼𝑹𝑨𝑴𝑨 𝑽𝑬𝑹", verification: true, media: true };
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
  const senderJid = decode(msg.key.participant || chatId);
  
  const isDeveloperSender = developer.isDeveloper({ pn: senderJid });

  if (activeMenuSessions.has(chatId)) {
      const oldSession = activeMenuSessions.get(chatId);
      sock.ev.off("messages.upsert", oldSession.listener);
      clearTimeout(oldSession.timer);
      activeMenuSessions.delete(chatId);
  }

  try {
    // The sender's permission context (isOwner/isHardcodedOwner/isElite/
    // isBypass) is resolved once per menu session and reused for every
    // render (main menu, category views) - it does not change mid-session.
    const ctx = await menuData.resolveSenderContext({ sock, msg, sender });

    const getMainMenuText = () => {
      const visibleHandlers = menuData.getVisibleHandlers(ctx);
      const categories = menuData.getVisibleCategoryNames(ctx);

      let totalCmds = 0;
      let eliteCmds = 0;
      let lockedCmds = 0;

      for (const handler of visibleHandlers) {
        totalCmds++;
        if (handler.lock === "on") lockedCmds++;
        if (handler.elite === "on" || menuData.permissionLabel(handler) !== "User") eliteCmds++;
      }

      let menu = `
✧━── ❝ 𝑨𝑺𝑻𝑨 𝑩𝑶𝑻 ❞ ──━✧

🩸⌁ ⚡ *الفئات المتوفّرة* ⚡ ⌁🩸
`;
      for (const c of categories) {
        menu += `\n✦◞ 🩸 *${c}* ◟✦`;
      }
      menu += `
      
 *✅️ اجمالي عدد الاوامر المتاحة لك :* ${totalCmds}
*🛡 عدد الأوامر المقيّدة ( نخبة/أعلى ) :* ${eliteCmds}
*🔐 عدد الاوامر المقفلة :* ${lockedCmds}
\n✍️ *اكتب اسم الفئة لعرض أوامرها.*
\n*لمعرفة معلومات المطور اكتب ( المطور ).*
\n*للمساعدة بأمر او فئة معيّنه اكتب ( مساعدة <اسم الأمر - اسم الفئة> ).*

✧━── ❝ 𝑲𝒉𝒂𝒍𝒊𝒅 𝐯1 ❞ ──━✧
`;
      return menu;
    };

    const getCategoryMenuText = (categoryName) => {
      const handlers = menuData.getVisibleHandlersInCategory(categoryName, ctx);

      let categoryMenu = `
✧━── ❝ 𝑲𝑯𝑨𝑳𝑰𝑫 𝑩𝑶𝑻 ❞ ──━✧

📂 *الفئة:* ${categoryName}

`;
      if (handlers.length === 0) {
        categoryMenu += `❗ لا توجد أوامر ظاهرة لك في هذه الفئة.\n`;
      } else {
        categoryMenu += handlers.map(menuData.formatCommandLine).join("\n\n");
      }

      categoryMenu += `

↩️ *اكتب "رجوع" للعودة لقائمة الفئات.*

✧━── ❝ 𝑲𝒉𝒂𝒍𝒊𝒅 𝐯1 ❞ ──━✧`;

      return categoryMenu;
    };

    const initialText = getMainMenuText();
    
    const sentMsg = await sock.sendMessage(chatId, { text: initialText }, { quoted: msg });
    const botMsgKey = sentMsg.key;

    let state = "MAIN"; 
    let sessionTimer; 

    const updateMessage = async (newText) => {
      await sock.sendMessage(chatId, { text: newText, edit: botMsgKey });
    };

    const listener = async ({ messages }) => {
      const newMsg = messages[0];
      if (!newMsg.message || newMsg.key.remoteJid !== chatId) return;
      
      const newSender = decode(newMsg.key.participant || newMsg.key.remoteJid);
      if (newSender !== senderJid && !isDeveloperSender) return; 

      const text = newMsg.message?.conversation || newMsg.message?.extendedTextMessage?.text || "";
      if (!text) return;
      const input = text.trim(); 

      if (input === "رجوع") {
        if (state === "CATEGORY_VIEW") {
          await sock.sendMessage(chatId, { react: { text: "🔙", key: newMsg.key } });
          await updateMessage(getMainMenuText());
          state = "MAIN";
          resetTimer();
        }
        return;
      }

      if (state === "MAIN") {
        const selectedCategory = menuData.findCategoryCaseInsensitive(input);

        if (selectedCategory) {
          await sock.sendMessage(chatId, { react: { text: "🆗", key: newMsg.key } });

          await updateMessage(getCategoryMenuText(selectedCategory));
          state = "CATEGORY_VIEW";
          resetTimer();
        } 
      }
    };

    const resetTimer = () => {
      if (sessionTimer) clearTimeout(sessionTimer);
      sessionTimer = setTimeout(() => {
        sock.ev.off("messages.upsert", listener);
        activeMenuSessions.delete(chatId);
      }, 3 * 60 * 1000); 

      activeMenuSessions.set(chatId, { listener, timer: sessionTimer });
    };

    resetTimer();
    sock.ev.on("messages.upsert", listener);

  } catch (err) {
    console.error("Menu Error:", err);
    await sock.sendMessage(chatId, { text: "❌ حدث خطأ أثناء إنشاء القائمة." });
  }
}

export default { AstaPlugin, execute };
