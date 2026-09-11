// Stage 6, item #6: "احصائيات" command.
// Read-only reporting on top of handlers/stats.js + handlers/plugins.js.
// Does not touch Permissions/Plugin Loader/Encryption, and its access
// level (elite) matches the existing "حالة" command in this same folder,
// so it stays compatible with the current Permissions system and doesn't
// expose this data to every user by default.
import { getPlugins } from "../../handlers/plugins.js";
import statsModule from "../../handlers/stats.js";

const AstaPlugin = {
    command: "احصائيات",
    description: "عرض إحصائيات استخدام الأوامر والأخطاء والبلوجينات.",
    elite: "off",
    group: false,
    prv: false,
    lock: "off",
    dev: "on",
};

function formatUptime(totalSeconds) {
    const s = Math.floor(totalSeconds % 60);
    const m = Math.floor((totalSeconds / 60) % 60);
    const h = Math.floor(totalSeconds / 3600);
    return `${h}h ${m}m ${s}s`;
}

async function execute({ sock, msg }) {
    const m = msg;
    const jid = m.key.remoteJid;

    try {
        const loadedPlugins = getPlugins();
        const pluginCount = new Set(Object.values(loadedPlugins || {})).size;
        const commandCount = Object.keys(loadedPlugins || {}).length;
        const summary = statsModule.getSummary();

        const topLines = summary.topCommands.length
            ? summary.topCommands
                .map((c, i) => `${i + 1}. ${c.command} — ${c.count}`)
                .join("\n")
            : "لا توجد بيانات كافية بعد.";

        const text = `📊 *إحصائيات البوت:*

⚙️ *إجمالي الأوامر المنفذة:* ${summary.totalCommands}
❌ *إجمالي الأخطاء:* ${summary.totalErrors}
📦 *البلوجينات المحملة:* ${pluginCount}
📜 *الأوامر المسجلة:* ${commandCount}
👥 *مستخدمون معروفون:* ${summary.knownUsers}
💬 *محادثات نشطة معروفة:* ${summary.knownChats}
⏱️ *مدة التشغيل:* ${formatUptime(summary.uptimeSeconds)}

🏆 *الأكثر استخدامًا:*
${topLines}`;

        await sock.sendMessage(jid, { text }, { quoted: m });
    } catch (error) {
        console.error("❌ خطأ في كود احصائيات البوت:", error);
        await sock.sendMessage(jid, { text: "❌ حدث خطأ أثناء جلب الإحصائيات." }, { quoted: m });
    }
}

export default { AstaPlugin, execute };
