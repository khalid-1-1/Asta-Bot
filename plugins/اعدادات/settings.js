import fs from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { generateWAMessageFromContent, jidDecode, downloadMediaMessage } from "@whiskeysockets/baileys";
import { loadPlugins } from '../../handlers/plugins.js'; 
import chalk from 'chalk';
import configObj from '../../asta/config.js'; 


import { updateEncryptionPassword } from '../../asta/dataUtils.js'; 



const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);




const AstaPlugin = {
    command: "اعدادات",
    description: "لوحة تحكم كاملة وشاملة ( زرف + ثيمات + أستا + أوامر + بوت )",
    elite: "off",
    group: false,
    prv: false,
    lock: "off",
    dev: "on",
};

const botDir = join(__dirname, "../../"); 
const themesDir = join(botDir, "asta", "themes");
const configPath = join(botDir, "asta", "config.js"); 
const pluginsDir = join(botDir, "plugins");
const zarfDir = join(botDir, "plugins", "zarf");
const zarfDataDir = join(botDir, "asta", "data"); 

if (!fs.existsSync(zarfDataDir)) fs.mkdirSync(zarfDataDir, { recursive: true });

const imagePath = join(botDir, "asta", "image.jpeg");
const audioPath = join(botDir, "asta", "sounds", "AUDIO.mp3");
const videoPath = join(zarfDataDir, "zarf.mp4");

const activeSessions = new Map();

const sleep = ms => new Promise(res => setTimeout(res, ms));

function getConfigValue(key) {
    const content = fs.readFileSync(configPath, "utf8");
    if (key === 'prefix') {
        const match = content.match(/let\s+prefix\s*=\s*['"](.*?)['"];/);
        return match ? match[1] : configObj.prefix;
    }
    if (key === 'astaInfo') {
        const match = content.match(/astaInfo:\s*({[\s\S]*?})(,|$)/); 
        if (match) {
            try { 
                return new Function(`return ${match[1]}`)(); 
            } catch (e) { return configObj.astaInfo; }
        }
        return configObj.astaInfo;
    }
    const regex = new RegExp(`${key}:\\s*['"](on|off)['"]`);
    const match = content.match(regex);
    return match ? match[1] : "off";
}

function updateConfigFile(key, value) {
    let content = fs.readFileSync(configPath, "utf8");
    if (key === 'prefix') {
        content = content.replace(/let\s+prefix\s*=\s*['"].*?['"];/, `let prefix = '${value}';`);
    } else if (key === 'astaInfo') {
        if (typeof value.media === 'undefined') value.media = true;
        const newObjStr = JSON.stringify(value, null, 4)
            .replace(/"(\w+)":/g, '$1:') 
            .replace(/\\"/g, '"'); 
        content = content.replace(/astaInfo:\s*{[\s\S]*?}(,|$)/, `astaInfo: ${newObjStr}$1`);
    } else {
        const regex = new RegExp(`(${key}:\\s*['"])(on|off)(['"])`, 'g');
        content = content.replace(regex, `$1${value}$3`);
    }
    fs.writeFileSync(configPath, content, "utf8");
}

function readZarfConfig(file) {
    const content = fs.readFileSync(file, "utf8");
    const match = content.match(/export\s+(let|const)\s+zarfConfig\s*=\s*{([\s\S]*?)};/m);
    if (!match) return null;
    return new Function(`return {${match[2]}}`)();
}

async function updateZarfFile(filePath, keyPath, value) {
    let code = fs.readFileSync(filePath, "utf8");
    const keyParts = keyPath.split(".").slice(1);
    const insertRegex = /export\s+(let|const)\s+zarfConfig\s*=\s*{([\s\S]*?)};/m;
    const match = code.match(insertRegex);
    if (!match) return;

    let config = new Function(`return {${match[2]}}`)();
    let temp = config;
    for (let i = 0; i < keyParts.length - 1; i++) {
        if (!temp[keyParts[i]]) temp[keyParts[i]] = {};
        temp = temp[keyParts[i]];
    }
    temp[keyParts.at(-1)] = value;

    const newConfig = JSON.stringify(config, null, 2)
        .replace(/"([a-zA-Z0-9_]+)":/g, "$1:")
        .replace(/"/g, "`");
    
    code = code.replace(match[2], newConfig.slice(1, -1));
    fs.writeFileSync(filePath, code, "utf8");
}

function getThemes() {
    if (!fs.existsSync(themesDir)) return [];
    return fs.readdirSync(themesDir, { withFileTypes: true })
        .filter(f => f.isDirectory())
        .map(f => f.name);
}



function setTheme(themeName) {
    const settingsPath = join(themesDir, "settings.txt");
    fs.writeFileSync(settingsPath, `[${themeName}]`, "utf8");
}

function performRestart(sock, msg) {
    const decode = jid => (jidDecode(jid)?.user || jid.split('@')[0]) + '@s.whatsapp.net';
    const sender = decode(msg.key.participant || msg.participant || msg.key.remoteJid);
    console.log('\n' + chalk.bgYellow.black.bold('[ System ]'), '🔄', chalk.bgHex('#FFD700').black(`Bot restart initiated by ${sender}`));
    process.send?.('reset');
    process.exit();
}

function readCommandSettings(filePath) {
    const code = fs.readFileSync(filePath, "utf8");
    const eliteMatch = code.match(/elite:\s*['"](on|off)['"]/i);
    const lockMatch = code.match(/lock:\s*['"](on|off)['"]/i);
    const devMatch = code.match(/dev:\s*['"](on|off)['"]/i);
    const groupMatch = code.match(/group:\s*(true|false)/i);
    const prvMatch = code.match(/prv:\s*(true|false)/i);
    return {
        elite: eliteMatch ? eliteMatch[1].toLowerCase() : null,
        lock: lockMatch ? lockMatch[1].toLowerCase() : null,
        dev: devMatch ? devMatch[1].toLowerCase() : null,
        group: groupMatch ? groupMatch[1].toLowerCase() === 'true' : null,
        prv: prvMatch ? prvMatch[1].toLowerCase() === 'true' : null
    };
}

function updateCommandSetting(filePath, setting, value) {
    let code = fs.readFileSync(filePath, "utf8");
    let regex, replacement;
    if (setting === 'elite' || setting === 'lock' || setting === 'dev') {
        regex = new RegExp(`(${setting}:\\s*['"])(on|off)(['"]\\s*,?)`, 'i');
        replacement = `$1${value}$3`; 
    } else if (setting === 'group' || setting === 'prv') {
        regex = new RegExp(`(${setting}:\\s*)(true|false)(\\s*,?)`, 'i');
        replacement = `$1${value}$3`;
    }
    if (regex && regex.test(code)) {
        code = code.replace(regex, replacement);
        fs.writeFileSync(filePath, code, "utf8");
        return true;
    }
    return false;
}

function getAllPluginFiles(dir, fileList = []) {
    if (!fs.existsSync(dir)) return [];
    fs.readdirSync(dir).forEach(file => {
        const filePath = join(dir, file);
        if (fs.statSync(filePath).isDirectory()) getAllPluginFiles(filePath, fileList);
        else if (file.endsWith(".js")) fileList.push(filePath);
    });
    return fileList;
}

async function findFileByCommand(cmdName) {
    const files = getAllPluginFiles(pluginsDir);
    for (const file of files) {
        const content = fs.readFileSync(file, "utf8");
        if (new RegExp(`command:\\s*['"\`]${cmdName}['"\`]`, 'i').test(content)) return file;
    }
    return null;
}

async function updateAllPluginsAsta(newStatus) {
    const files = getAllPluginFiles(pluginsDir);
    let count = 0;
    for (const filePath of files) {
        let code = fs.readFileSync(filePath, "utf8");
        
        if (/asta:\s*['"`](on|off)['"`]/.test(code)) {
            code = code.replace(/asta:\s*['"`](on|off)['"`]/g, `asta: "${newStatus}"`);
            fs.writeFileSync(filePath, code, "utf8");
            count++;
        }
    }
    return count;
}

function injectAstaIntoFile(filePath, forceUpdate = false) {
    if (filePath.includes("zarf") || filePath.includes("settings.js")) return "FORBIDDEN";
    let code = fs.readFileSync(filePath, "utf8");
    const configRegex = /(?:export\s+)?const\s+(\w+)\s*=\s*{([\s\S]*?)};/;
    const matchConfig = code.match(configRegex);
    if (!matchConfig) return "NO_CONFIG";
    
    const fullBlock = matchConfig[0];
    const configName = matchConfig[1];
    let configBody = matchConfig[2];

    configBody = configBody.replace(/(?:,\s*)?asta:\s*['"`](on|off)['"`].*?(\n|$)/gi, "\n");
    configBody = configBody.replace(/,(\s*,)+/g, ",");
    configBody = configBody.trim();
    if (configBody.length > 0 && !configBody.endsWith(",")) configBody += ",";

    const currentGlobalStatus = getConfigValue('asta');
    configBody += `\n  asta: "${currentGlobalStatus}"`;

    const newBlock = `${fullBlock.split("{")[0]}{\n${configBody}\n};`;
    code = code.replace(fullBlock, newBlock);

    const blockRegex = /\s*\/\/\s*ASTA_INJECTION_START[\s\S]*?\/\/\s*ASTA_INJECTION_END/g;
    const logicExists = blockRegex.test(code);

    if (forceUpdate && logicExists) {
        code = code.replace(blockRegex, "");
    } else if (logicExists && !forceUpdate) {
        fs.writeFileSync(filePath, code, "utf8");
        return "SUCCESS";
    }

    const requiredImports = [
        { check: /import\s+fs\s+from\s+['"]fs['"]/i, statement: 'import fs from "fs";' },
        { check: /import\s+path\s+from\s+['"]path['"]/i, statement: 'import path from "path";' },
        { check: /generateWAMessageFromContent/, statement: 'import { generateWAMessageFromContent } from "@whiskeysockets/baileys";' }
    ];

    let importsBlock = "";
    requiredImports.forEach(imp => {
        if (!imp.check.test(code)) importsBlock += imp.statement + "\n";
    });
    if (importsBlock) code = importsBlock + code;

    const execRegex = /async\s+function\s+execute\s*\(\s*{([^}]*)}\s*\)\s*{/;
    const execMatch = code.match(execRegex);
    if (!execMatch) return "NO_EXEC";

    const astaLogicBlock = `
    // ASTA_INJECTION_START
    const _asta_origSend = sock.sendMessage;
    sock.sendMessage = async (jid, content, options = {}) => {
        if (typeof ${configName} !== 'undefined' && ${configName}.asta === 'on') {
            const _textBody = content.text || content.caption;
            
            if (_textBody && typeof _textBody === 'string') {
                
                let _nD = { ceiling: "𝐴𝑁𝐴𝑆𝑇𝐴𝑆𝐼𝐴", name: "𝐀𝐧𝐚𝐬𝐭𝐚𝐬𝐢𝐚 𝐯𝟒", description: "𝚄𝙻𝚃𝚁𝙰 𝙽𝙾𝚅𝙰 𝚅𝙴𝚁", verification: true, media: true };
                try {
                    const _cfgPath = path.join(process.cwd(), "asta", "config.js");
                    const _cfgContent = fs.readFileSync(_cfgPath, "utf8");
                    const _match = _cfgContent.match(/astaInfo:\\s*({[\\s\\S]*?})(,|$)/);
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
    // ASTA_INJECTION_END
    `;

    code = code.replace(execMatch[0], execMatch[0] + astaLogicBlock);
    fs.writeFileSync(filePath, code, "utf8");
    return "SUCCESS";
}

function removeAstaFromFile(filePath) {
    let code = fs.readFileSync(filePath, "utf8");
    const configRegex = /(?:export\s+)?const\s+(\w+)\s*=\s*{([\s\S]*?)};/;
    const matchConfig = code.match(configRegex);

    if (matchConfig) {
        const fullBlock = matchConfig[0];
        let configBody = matchConfig[2];
        configBody = configBody.replace(/(?:,\s*)?asta:\s*['"`](on|off)['"`].*?(\n|$)/gi, "\n");
        configBody = configBody.replace(/\/\/\s*Auto-added.*/gi, "").replace(/,(\s*,)+/g, ",").trim();
        if (configBody.endsWith(",")) configBody = configBody.slice(0, -1);
        code = code.replace(fullBlock, `${fullBlock.split("{")[0]}{\n${configBody}\n};`);
    }

    const blockRegex = /\s*\/\/\s*ASTA_INJECTION_START[\s\S]*?\/\/\s*ASTA_INJECTION_END/g;
    code = code.replace(blockRegex, "");
    fs.writeFileSync(filePath, code, "utf8");
}

async function applyAstaSettingsToAll() {
    const files = getAllPluginFiles(pluginsDir);
    let count = 0;
    for (const file of files) {
        const content = fs.readFileSync(file, "utf8");
        if (/asta:\s*['"`](on|off)['"`]/.test(content) || content.includes("ASTA_INJECTION_START")) {
            if (injectAstaIntoFile(file, true) === "SUCCESS") count++;
        }
    }
    return count;
}

async function execute({ sock, msg, args }) {
    const chatId = msg.key.remoteJid;
    const sender = msg.key.participant || chatId;

    if (activeSessions.has(chatId)) {
        const previousSession = activeSessions.get(chatId);
        sock.ev.off("messages.upsert", previousSession.listener);
        clearTimeout(previousSession.timeout);
        activeSessions.delete(chatId);
    }
    const mainMenuText = 
`*اهلاً بك في الاعدادات ⚙️.*

- *ثيم*
\`🎨 لتغير الثيم بالكونسل.\`

- *أستا*
\`🫟 لعرض تفاصيل تأثير الأستا على الاوامر.\`

- *أوامر*
\`⛓️ للتحكم بالاوامر سواء جعلها للنخبة او للمجموعات او الخاص فقط.\`

- *بوت*
\`♻️ لتخصيص البوت للنخبة او اطفاء البوت او اعادة تشغيله.\`

- *بريفكس*
\`❗️ لتغيير البريفكس الخاص بالبوت\`

- *الزرف*
\`📂 لتغيير معلومات الزرف في البوت\`

`;

    const sentMsg = await sock.sendMessage(chatId, { text: mainMenuText }, { quoted: msg });
    let botMsgKey = sentMsg.key;
    let state = "MAIN"; 
    
    let zarfSection = null;
    let tempStorage = { password: "", targetFile: "", targetCmd: "" };
    
    const updateMessage = async (newText) => {
        await sock.sendMessage(chatId, { text: newText, edit: botMsgKey });
    };

    const listener = async ({ messages }) => {
        const newMsg = messages[0];
        if (!newMsg.message || newMsg.key.remoteJid !== chatId) return;
        const newSender = newMsg.key.participant || newMsg.key.remoteJid;
        if (newSender !== sender) return;

        const text = newMsg.message?.conversation || newMsg.message?.extendedTextMessage?.text || "";
        const hasMedia = newMsg.message?.imageMessage || newMsg.message?.audioMessage || newMsg.message?.videoMessage || newMsg.message?.documentMessage;
        
        if (!text && !hasMedia) return;
        const input = text ? text.trim() : "";

        const showThemeMenu = async () => {
            const folders = getThemes();
            if (!folders.length) return await updateMessage("⚠ لا يوجد ثيمات مثبتة.");

            const settingsPath = join(themesDir, "settings.txt");
            let currentTheme = "غير محدد";
            if (fs.existsSync(settingsPath)) {
                currentTheme = fs.readFileSync(settingsPath, "utf8").trim().replace(/[\[\]]/g, '');
            }

            const soundStatePath = join(themesDir, "soundState.txt");
            let isSoundOn = false;
            
            if (fs.existsSync(soundStatePath)) {
                const content = fs.readFileSync(soundStatePath, "utf8").trim();
                if (content === "[on]") isSoundOn = true;
            }

            const soundStatusText = isSoundOn ? "مفعل ✅️" : "مقفل ⛔️";
            const toggleCmd = isSoundOn ? "اطفاء" : "تشغيل";

            let themeList = `📂 *قائمة الثيمات:*\n💡 *الثيم الحالي : [ ${currentTheme} ]*\n\n` + 
                            folders.map(f => `- ${f}`).join('\n') + 
                            "\n\n✍️ *اكتب اسم الثيم لاختياره.*";

            themeList += `\n\n*الصوت : ${soundStatusText}*\n*لاطفاء/لتشغيل الاصوات اكتب "${toggleCmd}"*`;
            themeList += `\n\n🔙 *رجوع*`;
            
            await updateMessage(themeList);
        };

        if (state === "THEME_SELECT") {
            if (input === "رجوع") {
                await updateMessage(mainMenuText);
                state = "MAIN";
                return;
            }

            const soundStatePath = join(themesDir, "soundState.txt");

            if (input === "تشغيل") {
                fs.writeFileSync(soundStatePath, "[on]", "utf8");
                await updateMessage("✅ *تم تشغيل أصوات الثيمات.*");
                await sleep(2000); 
                await showThemeMenu(); 
                return;
            }

            if (input === "اطفاء") {
                fs.writeFileSync(soundStatePath, "[off]", "utf8");
                await updateMessage("⛔ *تم إيقاف أصوات الثيمات.*");
                await sleep(2000); 
                await showThemeMenu(); 
                return;
            }

            const folders = getThemes();
            if (folders.includes(input)) {
                setTheme(input);
                await updateMessage(`✅ *تم تغيير الثيم إلى:* ${input}\n🔄 *جاري إعادة التشغيل...*`);
                sock.ev.off("messages.upsert", listener);
                activeSessions.delete(chatId);
                await sleep(1000);
                performRestart(sock, msg);
            }
            return;
        }

        if (state === "MAIN") {
            if (input === "ثيم") {
                await showThemeMenu();
                state = "THEME_SELECT";
                return;
            }
                        else if (input === "أستا") {
                const status = getConfigValue('asta');
                const icon = status === "on" ? "✅" : "⛔";
                let astaMenu = `\`🫟 حالة الأستا الحالية :\` ${status}${icon}\n\n`;
                astaMenu += status === "off" ? `*تشغيل*\nلتشغيل تاثير الأستا.\n\n` : `*ايقاف*\n⛔ لإيقاف تاثير الأستا.\n\n`;
                astaMenu += `*تخصيص*\n➕ لإضافة تأثير أستا على امر محدد.\n\n*معلومات*\nℹ️ لعرض وتعديل بيانات الأستا.\n\n*رجوع* للعودة.`;
                await updateMessage(astaMenu);
                state = "ASTA_MENU";
                return;
            }
            else if (input === "أوامر") {
                await updateMessage("اكتب *اسم الأمر* الذي تريد التحكم في إعداداته:\n(أو اكتب *رجوع* للإلغاء)");
                state = "CMD_MENU_WAIT";
                return;
            }
            else if (input === "بوت") {
                const botStatus = getConfigValue('bot');
                const icon = botStatus === "on" ? "✅️" : "⛔️";
                const nextAction = botStatus === 'on' ? 'اطفاء' : 'تشغيل';
                let botMenu = `*اهلاً بك في حالة البوت.*\n\n` +
                              `- *مود* \n\`♻️ لتخصيص البوت للنخبة فقط او للجميع.\`\n\n` +
                              `- *ريستارت* \n\`🔄 لإعادة تشغيل البوت.\`\n\n` +
                              `*حالة البوت الآن : ${botStatus} ${icon}*\n\n\`⭕️ لإطفاء وتشغيل البوت.\`\n\n` +
                              `- \`${nextAction}\`\n\n` +
                              `- \`رجوع\``;
                await updateMessage(botMenu);
                state = "BOT_MENU";
                return;
            }
            else if (input === "بريفكس") {
                const currentPrefix = getConfigValue('prefix');
                await updateMessage(`\`البريفكس الحالي : (${currentPrefix})\`\nاكتب البريفكس الجديد او 'فارغ' لجعله فارغ\nاو اكتب *الغاء* للعودة.`);
                state = "PREFIX_WAIT";
                return;
            } 
            else if (input === "الزرف") {
                await showZarfMenu();
                state = "ZARF_MENU";
                return;
            }
                    } 
        if (state === "ZARF_MENU") {
            const zarfSections = ["اسم", "وصف", "منشن", "رسالة", "رياكت", "صورة", "صوت", "فيديو", "بوم"];
            if (input === "رجوع") { await updateMessage(mainMenuText); state = "MAIN"; return; }
            if (zarfSections.includes(input)) {
                return showZarfSection(input);
            }
            return;
        }

        if (state === "ZARF_SECTION") {
            if (input === "رجوع") { await showZarfMenu(); state = "ZARF_MENU"; return; }
            
            if (zarfSection === "بوم") {
                if (input === "شغل" || input === "طفي") {
                    const val = input === "شغل" ? "on" : "off";
                    const boomFile = await findFileByCommand("بوم");
                    
                    if (boomFile) {
                        let content = fs.readFileSync(boomFile, 'utf8');
                        if (/time:\s*['"](on|off)['"]/.test(content)) {
                            content = content.replace(/time:\s*['"](on|off)['"]/g, `time: "${val}"`);
                            fs.writeFileSync(boomFile, content, 'utf8');
                            
                            try { await loadPlugins(); } catch(e) {}
                            await updateMessage(`✅ تم ${input} المؤقت الزمني لـ بوم`);
                            await sleep(1000);
                            return showZarfSection("بوم");
                        } else {
                            await updateMessage("❌ لم يتم العثور على إعدادات الوقت في ملف البوم.");
                        }
                    } else {
                        await updateMessage("❌ لم يتم العثور على ملف الأمر 'بوم'.");
                    }
                    return;
                }
            }

            const files = fs.readdirSync(zarfDir).filter(f => f.endsWith(".js")).map(f => join(zarfDir, f));
            
            if (input === "شغل" || input === "طفي") {
                const val = input === "شغل" ? "on" : "off";
                const statusMap = { 
                    "اسم": "group.status", 
                    "وصف": "group.descStatus", 
                    "منشن": "mention.status", 
                    "رسالة": "finalMessage.status", 
                    "رياكت": "reaction.status", 
                    "صورة": "media.status", 
                    "صوت": "audio.status",
                    "فيديو": "video.status"
                };
                
                for (const f of files) { 
                    await updateZarfFile(f, `zarfConfig.${statusMap[zarfSection]}`, val); 
                }
                
                try { await loadPlugins(); } catch(e) { console.error("Reload Error:", e); }

                await updateMessage(`✅ تم ${input} ${zarfSection}`);
                await sleep(1000); 
                return showZarfSection(zarfSection);
            }

            if (input === "عدل") {
                if (zarfSection === "بوم") {
                    return updateMessage(`⚠️ *نظام ${zarfSection} لا يحتاج لتعديل (فقط تشغيل/إيقاف)*.`);
                }
                state = "ZARF_WAIT_EDIT";
                if (["صورة", "صوت", "فيديو"].includes(zarfSection)) {
                     return updateMessage(`📥 أرسل الـ *${zarfSection}* الآن (أو قم بالرد على ${zarfSection} سابق).`);
                }
                return updateMessage(`✍️ أرسل ${zarfSection} الجديد`);
            }
        }

        if (state === "ZARF_WAIT_EDIT") {
            if (input === "رجوع") { return showZarfSection(zarfSection); }
            
            const files = fs.readdirSync(zarfDir).filter(f => f.endsWith(".js")).map(f => join(zarfDir, f));
            const saveMedia = async (msgOrQuoted, type, pathToFile) => {
                 const buffer = await downloadMediaMessage({ message: msgOrQuoted }, "buffer");
                 fs.writeFileSync(pathToFile, buffer);
                 return true;
            };
            const quoted = newMsg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            let mediaSaved = false;

            for (const f of files) {
                if (zarfSection === "صورة") {
                    if (newMsg.message.imageMessage) {
                        await saveMedia({ imageMessage: newMsg.message.imageMessage }, "image", imagePath);
                        mediaSaved = true;
                    } else if (quoted?.imageMessage) {
                        await saveMedia({ imageMessage: quoted.imageMessage }, "image", imagePath);
                        mediaSaved = true;
                    } 
                    if (mediaSaved) await updateZarfFile(f, "zarfConfig.media.image", "image.jpeg");

                } else if (zarfSection === "صوت") {
                    if (newMsg.message.audioMessage) {
                        await saveMedia({ audioMessage: newMsg.message.audioMessage }, "audio", audioPath);
                        mediaSaved = true;
                    } else if (quoted?.audioMessage) {
                        await saveMedia({ audioMessage: quoted.audioMessage }, "audio", audioPath);
                        mediaSaved = true;
                    }
                    if (mediaSaved) await updateZarfFile(f, "zarfConfig.audio.file", "asta/sounds/AUDIO.mp3");

                } else if (zarfSection === "فيديو") {
                    const msgVideo = newMsg.message.videoMessage || newMsg.message.documentMessage;
                    const quotedVideo = quoted?.videoMessage || quoted?.documentMessage;

                    if (msgVideo) {
                        const fullMsg = newMsg.message.videoMessage ? { videoMessage: msgVideo } : { documentMessage: msgVideo };
                        await saveMedia(fullMsg, "video", videoPath);
                        mediaSaved = true;
                    } else if (quotedVideo) {
                        const fullMsg = quoted.videoMessage ? { videoMessage: quotedVideo } : { documentMessage: quotedVideo };
                        await saveMedia(fullMsg, "video", videoPath);
                        mediaSaved = true;
                    }
                    if (mediaSaved) await updateZarfFile(f, "zarfConfig.video.file", "asta/data/zarf.mp4");

                } else {
                    const editMap = { 
                        "اسم": "group.newSubject", 
                        "وصف": "group.newDescription", 
                        "منشن": "mention.text", 
                        "رسالة": "finalMessage.text", 
                        "رياكت": "reaction.emoji" 
                    };
                    await updateZarfFile(f, `zarfConfig.${editMap[zarfSection]}`, input);
                    mediaSaved = true; 
                }
            }

            if (["صورة", "صوت", "فيديو"].includes(zarfSection) && !mediaSaved) {
                return updateMessage(`❌ لم يتم العثور على ${zarfSection}! الرجاء إرساله مباشرة أو الرد عليه.`);
            }

            try { await loadPlugins(); } catch(e) { console.error("Reload Error:", e); }

            await updateMessage(`✅ تم تعديل وحفظ ${zarfSection} بنجاح.`);
            await sleep(1000); 
            state = "ZARF_SECTION";
            return showZarfSection(zarfSection);
        }

        if (state === "BOT_MENU") {
            if (input === "رجوع") { await updateMessage(mainMenuText); state = "MAIN"; return; }
            if (input === "ريستارت") {
                await updateMessage("🔄 جاري إعادة تشغيل البوت...");
                sock.ev.off("messages.upsert", listener);
                activeSessions.delete(chatId);
                performRestart(sock, msg);
                return;
            }
            if (input === "اطفاء") {
                updateConfigFile('bot', 'off');
                await updateMessage("⛔ تم إيقاف البوت بنجاح.");
                sock.ev.off("messages.upsert", listener);
                activeSessions.delete(chatId);
                return;
            }
            if (input === "تشغيل") {
                updateConfigFile('bot', 'on');
                await updateMessage("✅ تم تشغيل البوت بنجاح.");
                sock.ev.off("messages.upsert", listener);
                activeSessions.delete(chatId);
                return;
            }
            if (input === "مود") {
                const modeStatus = getConfigValue('mode');
                const nextAction = modeStatus === 'on' ? 'اطفاء' : 'تشغيل';
                const icon = modeStatus === "on" ? "✅️" : "⛔️";
                await updateMessage(`*حالة المود الآن : ${modeStatus} ${icon}*\n\n- \`${nextAction}\`\n\n- \`رجوع\``);
                state = "MODE_MENU";
                return;
            }
            return;
        }

        if (state === "MODE_MENU") {
            if (input === "رجوع") {
                state = "BOT_MENU";
                return listener({messages:[{message:{conversation:" بوت"},key:{remoteJid:chatId,participant:sender}}]});
            }
            if (input === "تشغيل") {
                updateConfigFile('mode', 'on');
                await updateMessage("✅️ تم تفعيل وضع النخبة (Mode on).");
                await sleep(1000);
                await updateMessage(`*حالة المود الآن : on ✅️*\n\n- \`اطفاء\`\n\n- \`رجوع\``);
                return;
            }
            if (input === "اطفاء") {
                updateConfigFile('mode', 'off');
                await updateMessage("⛔️ تم تعطيل وضع النخبة (Mode off).");
                await sleep(1000);
                await updateMessage(`*حالة المود الآن : off ⛔️*\n\n- \`تشغيل\`\n\n- \`رجوع\``);
                return;
            }
        }

        if (state === "PREFIX_WAIT") {
            if (input === "الغاء") { await updateMessage(mainMenuText); state = "MAIN"; return; }
            if (input.includes(" ")) return; 
            const newPrefix = input === "فارغ" ? "" : input;
            updateConfigFile('prefix', newPrefix);
            await updateMessage(`✅ تم تغيير البريفكس بنجاح!`);
            sock.ev.off("messages.upsert", listener);
            activeSessions.delete(chatId);
            return;
        }

        if (state === "ASTA_MENU") {
            if (input === "رجوع") { await updateMessage(mainMenuText); state = "MAIN"; return; }
            
            if (input === "تشغيل") {
                updateConfigFile('asta', 'on');
                await updateMessage("🔄 *جاري تحديث جميع الأوامر...*");
                await updateAllPluginsAsta("on");
                try { await loadPlugins(); } catch(e) {}
                await updateMessage("`✅ تم تشغيل نظام الأستا وتحديث الأوامر.`");
                sock.ev.off("messages.upsert", listener);
                activeSessions.delete(chatId);
                return;
            }
            if (input === "ايقاف") {
                updateConfigFile('asta', 'off');
                await updateMessage("🔄 *جاري إيقاف الأوامر...*");
                await updateAllPluginsAsta("off");
                try { await loadPlugins(); } catch(e) {}
                await updateMessage("`⛔ تم إيقاف نظام الأستا.`");
                sock.ev.off("messages.upsert", listener);
                activeSessions.delete(chatId);
                return;
            }
            if (input === "تخصيص") { 
                await updateMessage("اكتب *اسم الأمر* الذي تريد إضافة تأثير أستا له:\n(أو اكتب *رجوع* للإلغاء)"); 
                state = "ASTA_CUSTOMIZE_WAIT"; 
                return; 
            }
            if (input === "معلومات") { 
                await showInfoMenu(); 
                state = "ASTA_INFO"; 
                return; 
            }
            return;
        }

        async function showInfoMenu() {
            const data = getConfigValue('astaInfo');
            const ceilingDisplay = data.ceiling === "" ? "(فارغ)" : data.ceiling;
            const verifyDisplay = data.verification ? "مفعل ✅" : "معطل ❌";
            const mediaDisplay = (data.media !== false) ? "مفعل ✅" : "معطل ❌";

            const infoText = `*المعلومات الحالية (Config):*\n\nالسقف : ${ceilingDisplay}\nالاسم : ${data.name}\nالوصف : ${data.description}\nتوثيق : ${verifyDisplay}\nصورة : ${mediaDisplay}\n\n- *حفظ* لتطبيق التعديلات.\nللتغير اكتب اسم الخانة (السقف، الاسم، الوصف، توثيق، صورة).\nاكتب *رجوع* للعودة.`;
            await updateMessage(infoText);
        }

        if (state === "ASTA_INFO") {
            let data = getConfigValue('astaInfo');

            if (input === "رجوع") {
                state = "ASTA_MENU";
                return listener({messages:[{message:{conversation:"أستا"},key:{remoteJid:chatId,participant:sender}}]});
            }
            if (input === "حفظ") {
                await updateMessage("🔄 *جاري تطبيق التعديلات (وحذف/إضافة الثامنيل)...*");

                const count = await applyAstaSettingsToAll();
                try { await loadPlugins(); } catch(e) {}
                await updateMessage(`✅ *تم حفظ البيانات وتحديث ${count} ملف بنجاح.*`);
                await sleep(1500); 
                await showInfoMenu(); 
                return;
            }
            if (input === "السقف") { 
                await updateMessage("يرجى كتابة السقف الجديد.\n(اكتب *فارغ* لجعله بدون نص)\nاكتب *رجوع* للعودة."); 
                state = "ASTA_EDIT_CEILING"; 
                return; 
            }
            if (input === "الاسم") { 
                await updateMessage("يرجى كتابة الاسم الجديد.\nاكتب *رجوع* للعودة."); 
                state = "ASTA_EDIT_NAME"; 
                return; 
            }
            if (input === "الوصف") { 
                await updateMessage("يرجى كتابة الوصف الجديد.\nاكتب *رجوع* للعودة."); 
                state = "ASTA_EDIT_DESC"; 
                return; 
            }
            if (input === "توثيق" || input === "التوثيق") {
                let toggleMsg = `*حالة شارة التوثيق :* ${data.verification?"on":"off"} ${data.verification?"✅":"❌"}\n\n- *${data.verification?"ايقاف":"تشغيل"}* لتغيير الحالة.\n- *رجوع* للعودة.`;
                await updateMessage(toggleMsg);
                state = "ASTA_EDIT_VERIFY";
                return;
            }

            if (input === "صورة" || input === "الصورة") {
                const isMediaOn = data.media !== false; 
                let toggleMsg = `*حالة الصورة (Thumbnail) :* ${isMediaOn?"on":"off"} ${isMediaOn?"✅":"❌"}\n\n- *${isMediaOn?"ايقاف":"تشغيل"}* لتغيير الحالة.\n- *رجوع* للعودة.`;
                await updateMessage(toggleMsg);
                state = "ASTA_EDIT_MEDIA";
                return;
            }
            return;
        }

        if (state === "ASTA_EDIT_MEDIA") {
            let data = getConfigValue('astaInfo');
            if (input === "رجوع") { state = "ASTA_INFO"; await showInfoMenu(); return; }
            if (input === "تشغيل") { 
                data.media = true; 
                updateConfigFile('astaInfo', data); 
                await updateMessage("✅ تم تفعيل الصورة (اضغط *حفظ* للتطبيق)."); 
                await sleep(1000); 
                state = "ASTA_INFO"; 
                await showInfoMenu(); 
                return; 
            }
            if (input === "ايقاف") { 
                data.media = false; 
                updateConfigFile('astaInfo', data); 
                await updateMessage("⛔ تم تعطيل الصورة (اضغط *حفظ* للتطبيق)."); 
                await sleep(1000); 
                state = "ASTA_INFO"; 
                await showInfoMenu(); 
                return; 
            }
        }

        if (state === "ASTA_EDIT_VERIFY") {
            let data = getConfigValue('astaInfo');
            if (input === "رجوع") { state = "ASTA_INFO"; await showInfoMenu(); return; }
            if (input === "تشغيل") { 
                data.verification = true; 
                updateConfigFile('astaInfo', data); 
                await updateMessage("✅ تم تفعيل شارة التوثيق (اضغط *حفظ* للتطبيق)."); 
                await sleep(1000); 
                state = "ASTA_INFO"; 
                await showInfoMenu(); 
                return; 
            }
            if (input === "ايقاف") { 
                data.verification = false; 
                updateConfigFile('astaInfo', data); 
                await updateMessage("⛔ تم تعطيل شارة التوثيق (اضغط *حفظ* للتطبيق)."); 
                await sleep(1000); 
                state = "ASTA_INFO"; 
                await showInfoMenu(); 
                return; 
            }
            return;
        }
        if (state === "ASTA_EDIT_CEILING") {
            let data = getConfigValue('astaInfo');
            if (input === "رجوع") { state = "ASTA_INFO"; await showInfoMenu(); return; }
            let newValue = input === "فارغ" ? "" : input;
            
            data.ceiling = newValue;
            updateConfigFile('astaInfo', data);
            
            await updateMessage("✅ تم تحديث السقف (اضغط *حفظ* للتطبيق)."); 
            await sleep(1000); 
            state = "ASTA_INFO"; 
            await showInfoMenu(); 
            return;
        }
        if (state === "ASTA_EDIT_NAME") {
            let data = getConfigValue('astaInfo');
            if (input === "رجوع") { state = "ASTA_INFO"; await showInfoMenu(); return; }
            
            data.name = input;
            updateConfigFile('astaInfo', data);
            
            await updateMessage("✅ تم تحديث الاسم (اضغط *حفظ* للتطبيق)."); 
            await sleep(1000); 
            state = "ASTA_INFO"; 
            await showInfoMenu(); 
            return;
        }
        if (state === "ASTA_EDIT_DESC") {
            let data = getConfigValue('astaInfo');
            if (input === "رجوع") { state = "ASTA_INFO"; await showInfoMenu(); return; }
            
            data.description = input;
            updateConfigFile('astaInfo', data);
            
            await updateMessage("✅ تم تحديث الوصف (اضغط *حفظ* للتطبيق)."); 
            await sleep(1000); 
            state = "ASTA_INFO"; 
            await showInfoMenu(); 
            return;
        }

        if (state === "ASTA_CUSTOMIZE_WAIT") {
            if (input === "رجوع") {
                state = "ASTA_MENU";
                return listener({messages:[{message:{conversation:"أستا"},key:{remoteJid:chatId,participant:sender}}]});
            }
            const cmdName = input.split(" ")[0]; 
            const filePath = await findFileByCommand(cmdName);
            if (!filePath) return await updateMessage("❌ لم يتم العثور على *الامر*، حاول مرة أخرى او اكتب *رجوع*.");

            const fileContent = fs.readFileSync(filePath, "utf8");
            if (/asta:\s*['"`](on|off)['"`]/.test(fileContent) || fileContent.includes("ASTA_INJECTION_START")) {
                tempStorage.targetFile = filePath; 
                tempStorage.targetCmd = cmdName;
                await updateMessage(`\`⚠️ تأثير الأستا موجود في هذا الامر بالفعل\`\n\n*ازل*\nلإزالة تاثير الأستا منه.\n*رجوع*\nللعودة الى الصفحة السابقة.`);
                state = "ASTA_REMOVE_CONFIRM";
                return;
            }
            const res = injectAstaIntoFile(filePath);
            if (res === "FORBIDDEN") { 
                await updateMessage("⚠️ *امر غير صالح للأستا يرجى كتابة امر اخر*"); 
                await sleep(2000); 
                await updateMessage("اكتب *اسم الأمر* الذي تريد إضافة تأثير أستا له:\n(أو اكتب *رجوع* للإلغاء)"); 
                return; 
            }
            if (res === "SUCCESS") { 
                try { await loadPlugins(); } catch(e) {} 
                await updateMessage(`\`🫟 تم اضافة تأثير الأستا على *${cmdName}* بنجاح.\``); 
                sock.ev.off("messages.upsert", listener); 
                activeSessions.delete(chatId);
                return; 
            }
            await updateMessage(`❌ حدث خطأ تقني: ${res}`); 
            sock.ev.off("messages.upsert", listener); 
            activeSessions.delete(chatId);
            return;
        }

        if (state === "ASTA_REMOVE_CONFIRM") {
            if (input === "ازل" || input === "أزل") {
                removeAstaFromFile(tempStorage.targetFile); 
                try { await loadPlugins(); } catch(e) {}
                await updateMessage(`\`✴️ تم ازالة تأثير الأستا على *${tempStorage.targetCmd}* بنجاح.\``); 
                sock.ev.off("messages.upsert", listener);
                activeSessions.delete(chatId);
                return;
            } else if (input === "رجوع") { 
                await updateMessage("اكتب *اسم الأمر* الذي تريد إضافة تأثير أستا له:"); 
                state = "ASTA_CUSTOMIZE_WAIT"; 
            }
            return;
        }

        if (state === "CMD_MENU_WAIT") {
            if (input === "رجوع") { await updateMessage(mainMenuText); state = "MAIN"; return; }
            
            const cmdName = input.split(" ")[0]; 
            const filePath = await findFileByCommand(cmdName);
            
            if (!filePath) { 
                await updateMessage("❌ لم يتم العثور على *الامر*، حاول مرة أخرى او اكتب *رجوع*."); 
                return; 
            }
            if (filePath.includes("zarf") || filePath.includes("settings.js")) { 
                await updateMessage("⚠️ *هذا الأمر محمي ولا يمكن تعديل إعداداته.*"); 
                await sleep(2000); 
                await updateMessage("اكتب *اسم الأمر* الذي تريد التحكم في إعداداته:\n(أو اكتب *رجوع* للإلغاء)"); 
                return; 
            }
            
            tempStorage.targetFile = filePath; 
            tempStorage.targetCmd = cmdName;
            await showCmdSettingsMenu(); 
            state = "CMD_EDIT_MENU"; 
            return;
        }

        if (state === "CMD_EDIT_MENU") {
            if (input === "رجوع") { await updateMessage(mainMenuText); state = "MAIN"; return; }
            
            const currentSettings = readCommandSettings(tempStorage.targetFile);
            
            if (input === "نخبة") { 
                const v = currentSettings.elite==="on"?"off":"on"; 
                updateCommandSetting(tempStorage.targetFile,"elite",v); 
                await showTempMessage(v==="on"?`✅ تم تشغيل النخبة لامر *${tempStorage.targetCmd}*!`:`⛔ تم اطفاء النخبة في امر *${tempStorage.targetCmd}*!`); 
            }
            else if (input === "قفل") { 
                const v = currentSettings.lock==="on"?"off":"on"; 
                updateCommandSetting(tempStorage.targetFile,"lock",v); 
                await showTempMessage(v==="on"?`🔒 تم قفل الأمر *${tempStorage.targetCmd}* (Owner فقط - أساسي أو ديناميكي)!`:`🔓 تم فتح الأمر *${tempStorage.targetCmd}*!`); 
            }
            else if (input === "مطور") { 
                const v = currentSettings.dev==="on"?"off":"on"; 
                updateCommandSetting(tempStorage.targetFile,"dev",v); 
                await showTempMessage(v==="on"?`🛡️ تم قصر الأمر *${tempStorage.targetCmd}* على المطور الأساسي فقط!`:`✅ تم إلغاء قصر الأمر *${tempStorage.targetCmd}* على المطور!`); 
            }
            else if (input === "مجموعات") { 
                updateCommandSetting(tempStorage.targetFile,"group","true"); 
                updateCommandSetting(tempStorage.targetFile,"prv","false"); 
                await showTempMessage(`✅ تم تفعيل المجموعات (وتعطيل الخاص) لامر *${tempStorage.targetCmd}*!`); 
            }
            else if (input === "خاص") { 
                updateCommandSetting(tempStorage.targetFile,"prv","true"); 
                updateCommandSetting(tempStorage.targetFile,"group","false"); 
                await showTempMessage(`✅ تم تفعيل الخاص (وتعطيل المجموعات) لامر *${tempStorage.targetCmd}*!`); 
            }
            else if (input === "ضبط") { 
                updateCommandSetting(tempStorage.targetFile,"group","false"); 
                updateCommandSetting(tempStorage.targetFile,"prv","false"); 
                await showTempMessage(`🔄 تم ضبط إعدادات امر *${tempStorage.targetCmd}* ليعمل في كل مكان!`); 
            }
            return;
        }

        async function showCmdSettingsMenu() {
            const s = readCommandSettings(tempStorage.targetFile);
            const menuText = `\`تفاصيل الامر (${tempStorage.targetCmd})📋:\`\n\n\`الامر :\` ${tempStorage.targetCmd}\n\n*الخانة | الحالة*\n\`نخبة :\` ${s.elite==="on"?"✅":"❌"}\n\`قفل (Owner) :\` ${s.lock==="on"?"✅":"❌"}\n\`مطور فقط :\` ${s.dev==="on"?"✅":"❌"}\n\`مجموعات :\` ${s.group?"✅":"❌"}\n\`خاص :\` ${s.prv?"✅":"❌"}\n\nاكتب *ضبط* لجعل الأمر يعمل بالمجموعات والخاص بنفس الوقت.\nاكتب اسم الخانة للتعديل عليها.\nاكتب *رجوع* للعودة.`;
            await updateMessage(menuText);
        }

        async function showTempMessage(msg) {
            await updateMessage(msg); 
            try { await loadPlugins(); } catch(e) {} 
            await sleep(2000); 
            await showCmdSettingsMenu();
        }
    };

    async function showZarfMenu() {
        const text = `✧━── ❝ 𝐄𝐃𝐈𝐓 𝐙𝐀𝐑𝐅 ❞ ──━✧\n\n✦ اسم\n✦ وصف\n✦ منشن\n✦ رسالة\n✦ رياكت\n✦ صورة\n✦ صوت\n✦ فيديو\n✦ بوم\n\n✍️ اكتب اسم القسم\n🔙 رجوع\n\n✧━── ❝ 𝑲𝒉𝒂𝒍𝒊𝒅 𝐯1 ❞ ──━✧`;
        await updateMessage(text);
    }

    async function showZarfSection(section) {
        zarfSection = section;
        state = "ZARF_SECTION";
        
        if (section === "بوم") {
            let status = "off";
            const boomFile = await findFileByCommand("بوم");
            if (boomFile) {
                const content = fs.readFileSync(boomFile, 'utf8');
                const match = content.match(/time:\s*['"](on|off)['"]/);
                if (match) status = match[1];
            }
            
            const toggleAction = status === "on" ? "طفي" : "شغل";

            await updateMessage(
`✧━── ❝ 𝐄𝐃𝐈𝐓 𝐙𝐀𝐑𝐅 ❞ ──━✧\n\n✦ بوم\n\n📄 الميزة: تحديد المدة الزمنية قبل التفجير\n⚙️ الحالة: ${status === "on" ? "on ✅" : "off ⛔"}\n\n🔘 ${toggleAction}\n🔙 رجوع\n\n✧━── ❝ 𝑲𝒉𝒂𝒍𝒊𝒅 𝐯1 ❞ ──━✧`
            );
            return;
        }

        const files = fs.readdirSync(zarfDir).filter(f => f.endsWith(".js")).map(f => join(zarfDir, f));
        const cfg = readZarfConfig(files[0]);
        
        const map = {
            "اسم": ["group.newSubject", "group.status"],
            "وصف": ["group.newDescription", "group.descStatus"],
            "منشن": ["mention.text", "mention.status"],
            "رسالة": ["finalMessage.text", "finalMessage.status"],
            "رياكت": ["reaction.emoji", "reaction.status"],
            "صورة": ["media.image", "media.status"],
            "صوت": ["audio.file", "audio.status"],
            "فيديو": ["video.file", "video.status"]
        };

        const [valKey, statusKey] = map[section] || [];
        let value = "غير محدد";
        
        if (valKey) {
            value = valKey.split(".").reduce((o, k) => o?.[k], cfg) || "غير محدد";
        }

        const status = statusKey?.split(".").reduce((o, k) => o?.[k], cfg) || "off";
        const toggleAction = status === "on" ? "طفي" : "شغل";

        const editOption = "\n✏️ عدل";

        await updateMessage(
`✧━── ❝ 𝐄𝐃𝐈𝐓 𝐙𝐀𝐑𝐅 ❞ ──━✧\n\n✦ ${section}\n\n📄 الحالي: ${value}\n⚙️ الحالة: ${status === "on" ? "on ✅" : "off ⛔"}\n${editOption}\n🔘 ${toggleAction}\n🔙 رجوع\n\n✧━── ❝ 𝑲𝒉𝒂𝒍𝒊𝒅 𝐯1 ❞ ──━✧`
        );
    }

    sock.ev.on("messages.upsert", listener);
    
    const timeoutId = setTimeout(() => { 
        sock.ev.off("messages.upsert", listener); 
        activeSessions.delete(chatId);
    }, 300_000);

    activeSessions.set(chatId, { listener, timeout: timeoutId });
}

export default { AstaPlugin, execute };
