import { jidDecode } from "@whiskeysockets/baileys";
// Stage 6, item #5: extended in-place with real Bot Status data (plugins
// loaded, commands registered, commands executed, errors, memory, Node
// version) sourced from handlers/plugins.js + handlers/stats.js. The
// original command name/behavior (سرعة + مدة) is unchanged - this is a
// merge, not a replacement, per the Stage 6 request ("لا تستبدله عشوائيًا").
import { getPlugins } from "../../handlers/plugins.js";
import statsModule from "../../handlers/stats.js";

const AstaPlugin = {
    command: "حالة",
    description: "عرض حالة البوت والسرعة والمدة والإحصائيات الأساسية.",
    elite: "off",
    group: false,
    prv: false,
    lock: "on",
  dev: "off",
};

async function execute({ sock, msg }) {
    const m = msg; 

    try {
        const jid = m.key.remoteJid;
        
        const start = Date.now();

        
        const uptimeSeconds = process.uptime();
        const uptimeFormatted = new Date(uptimeSeconds * 1000).toISOString().substr(11, 8);
        
        const end = Date.now();
        const ping = end - start; 

        // Best-effort extra status block. Wrapped separately so that if
        // plugins.js/stats.js ever throw, the base حالة command (speed +
        // uptime) still replies exactly like it always has.
        let extra = "";
        try {
            const loadedPlugins = getPlugins();
            const pluginCount = new Set(Object.values(loadedPlugins || {})).size;
            const commandCount = Object.keys(loadedPlugins || {}).length;
            const summary = statsModule.getSummary();
            const memMB = (process.memoryUsage().rss / 1024 / 1024).toFixed(1);

            extra = `\n\n📦 *البلوجينات المحملة:* ${pluginCount}` +
                    `\n📜 *الأوامر المسجلة:* ${commandCount}` +
                    `\n⚙️ *الأوامر المنفذة:* ${summary.totalCommands}` +
                    `\n❌ *الأخطاء:* ${summary.totalErrors}` +
                    `\n🧠 *الذاكرة المستخدمة:* ${memMB} MB` +
                    `\n🟢 *Node.js:* ${process.version}`;
        } catch (e) {
            // Stats/plugin info is a bonus on top of the original command.
        }
        
        const statusMessage = `🟢 *حالة البوت:*
⏳ *السرعة:* ${ping}ms
⏱️ *المدة:* ${uptimeFormatted}${extra}`;

        await sock.sendMessage(jid, { text: statusMessage }, { quoted: m });
        
    } catch (error) {
        console.error("❌ خطأ في كود حالة البوت:", error);
        await sock.sendMessage(m.key.remoteJid, { text: "❌ حدث خطأ أثناء جلب حالة البوت." }, { quoted: m });
    }
}

export default { AstaPlugin, execute };
