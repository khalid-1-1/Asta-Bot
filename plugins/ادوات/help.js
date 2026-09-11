import menuData from "../../handlers/menuData.js";

/**
 * plugins/ادوات/help.js
 * -----------------------------------------------------------------------
 * Stage 4 — "مساعدة" command.
 *
 * All data comes from getPlugins() via handlers/menuData.js (same source
 * menu.js uses) - no hardcoded command/category lists. Permission
 * filtering is delegated to handlers/permissions.js (through menuData) so
 * a command a sender is not allowed to run is never revealed here either,
 * consistent with the "اوامر" interactive menu.
 *
 *   مساعدة                -> main menu + how to use help
 *   مساعدة <category>     -> commands in that category
 *   مساعدة <command>      -> full metadata card for that command
 */

const AstaPlugin = {
  command: "مساعدة",
  description: "نظام المساعدة — عرض الفئات أو تفاصيل أمر معيّن",
  usage: "مساعدة [فئة أو اسم أمر]",
  elite: "off",
  group: false,
  prv: false,
  lock: "off",
  dev: "off",
};

function renderMainHelp(ctx) {
  const categories = menuData.getVisibleCategoryNames(ctx);

  let text = `
✧━── ❝ 𝑨𝑺𝑻𝑨 — 𝑯𝑬𝑳𝑷 ❞ ──━✧

🩸⌁ ⚡ *الفئات المتوفّرة* ⚡ ⌁🩸
`;
  for (const c of categories) {
    text += `\n✦◞ 🩸 *${c}* ◟✦`;
  }

  text += `

✍️ *طرق الاستخدام:*
• مساعدة — عرض هذه القائمة
• مساعدة <فئة> — عرض أوامر فئة معيّنة
• مساعدة <أمر> — عرض تفاصيل أمر معيّن

↩️ يمكنك أيضًا استخدام القائمة التفاعلية عبر ( اوامر ).

✧━── ❝ 𝑲𝒉𝒂𝒍𝒊𝒅 𝐯1 ❞ ──━✧
`;
  return text;
}

function renderCategoryHelp(categoryName, ctx) {
  const handlers = menuData.getVisibleHandlersInCategory(categoryName, ctx);

  let text = `
✧━── ❝ 𝑨𝑺𝑻𝑨 — 𝑯𝑬𝑳𝑷 ❞ ──━✧

📂 *الفئة:* ${categoryName}

`;
  if (handlers.length === 0) {
    text += `❗ لا توجد أوامر ظاهرة لك في هذه الفئة.\n`;
  } else {
    text += handlers.map(menuData.formatCommandLine).join("\n\n");
  }

  text += `

↩️ *للعودة لكل الفئات اكتب "مساعدة".*

✧━── ❝ 𝑲𝒉𝒂𝒍𝒊𝒅 𝐯1 ❞ ──━✧`;
  return text;
}

function renderCommandHelp(handler) {
  const aliases = menuData.aliasesOf(handler);
  const primary = menuData.primaryCommandOf(handler);

  let text = `🎮 *اسم الأمر:* ${primary}\n\n`;
  text += `📝 *الوصف:*\n${handler.description ? handler.description : "لا يوجد وصف لهذا الأمر."}\n\n`;

  // Never invent a Usage that the plugin author didn't provide (item #4).
  if (handler.usage) {
    text += `📌 *الاستخدام:*\n${handler.usage}\n\n`;
  }

  text += `🔄 *البدائل:*\n${aliases.length > 0 ? aliases.join(", ") : "لا يوجد"}\n\n`;
  text += `📂 *الفئة:*\n${handler.category}\n\n`;
  text += `🛡 *الصلاحية:*\n${menuData.permissionLabel(handler)}`;

  if (handler.lock === "on") {
    text += `\n\n🔐 *ملاحظة:* هذا الأمر محمي بكلمة مرور.`;
  }

  return text;
}

function notFoundMessage() {
  return `❌ لم يتم العثور على فئة أو أمر بهذا الاسم.\n\nجرّب كتابة ( مساعدة ) لعرض كل الفئات المتاحة.`;
}

async function execute({ sock, msg, args, sender }) {
  const chatId = msg.key.remoteJid;

  try {
    const ctx = await menuData.resolveSenderContext({ sock, msg, sender });
    const query = (args || []).join(" ").trim();

    if (!query) {
      return await sock.sendMessage(chatId, { text: renderMainHelp(ctx) }, { quoted: msg });
    }

    // Try the full query first (covers multi-word category/command names),
    // then fall back to just the first word (covers "مساعدة اكس شيء إضافي").
    const candidates = [query];
    if (args[0] && args[0] !== query) candidates.push(args[0]);

    for (const candidate of candidates) {
      const category = menuData.findCategoryCaseInsensitive(candidate);
      if (category) {
        return await sock.sendMessage(chatId, { text: renderCategoryHelp(category, ctx) }, { quoted: msg });
      }
    }

    for (const candidate of candidates) {
      const handler = menuData.findHandlerByCommand(candidate);
      // Hidden/unauthorized commands are treated as "not found" so Help
      // never reveals their existence to a sender who can't use them.
      if (handler && menuData.isVisibleTo(handler, ctx)) {
        return await sock.sendMessage(chatId, { text: renderCommandHelp(handler) }, { quoted: msg });
      }
    }

    return await sock.sendMessage(chatId, { text: notFoundMessage() }, { quoted: msg });
  } catch (err) {
    console.error("Help Error:", err);
    await sock.sendMessage(chatId, { text: "❌ حدث خطأ أثناء عرض المساعدة." }, { quoted: msg });
  }
}

export default { AstaPlugin, execute };
