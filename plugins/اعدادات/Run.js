let pending = {};

async function execute({ sock, msg, args, sender }) {
    const chatId = msg.key.remoteJid;

    try {
        
        if (pending[sender.pn]) {

            const nums = args[0]?.split(",").map(x => parseInt(x.trim()));

            if (!nums || nums.some(isNaN)) {
                return sock.sendMessage(chatId, { text: "❌ استخدم الشكل: 1,2,3" });
            }

            const data = pending[sender.pn];

            let executedGroups = [];

            nums.forEach(num => {
                const group = data.groups[num - 1];
                if (group) {
                    sock.sendMessage(group.id, { text: data.cmd });
                    executedGroups.push(group.subject);
                }
            });

            delete pending[sender.pn];

            if (executedGroups.length)
                return sock.sendMessage(chatId, {
                    text: `✅ تم التنفيذ في الجروبات التالية:\n${executedGroups.join("\n")}`
                });
            else
                return sock.sendMessage(chatId, { text: "❌ لم يتم تنفيذ الأمر، تحقق من الأرقام." });
        }

        
        if (!args.length) {
            return sock.sendMessage(chatId, {
                text: "❌ اكتب الأمر\nمثال:\nrun الامر"
            });
        }

        const cmd = args.join(" ");

        const groups = await sock.groupFetchAllParticipating();
        const list = Object.values(groups);

        let text = "📋 اختار الجروبات (مثال: 1,2,3):\n\n";

        list.forEach((g, i) => {
            text += `${i + 1}. ${g.subject}\n`;
        });

        pending[sender.pn] = {
            groups: list,
            cmd: cmd
        };

        await sock.sendMessage(chatId, { text });

    } catch (err) {
        console.log("RUN ERROR:", err);
        await sock.sendMessage(chatId, { text: "❌ حصل خطأ" });
    }
}

export const AstaPlugin = {
    command: ["run"],
    description: "تنفيذ اي أمر في صمت في اي جروب تختاره",
    elite: "off",
    group: false,
    prv: false,
    lock: "off",
  dev: "on",
};

export default { AstaPlugin, execute };