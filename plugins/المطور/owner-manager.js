import permissions from "../../handlers/permissions.js";

const usageMessage =
  "❌ أمر غير معروف.\n\n" +
  "الأوامر المتاحة:\n" +
  "• اونر اضف [منشن/رد/رقم]\n" +
  "• اونر ازل [منشن/رد/رقم]\n" +
  "• اونر عرض\n" +
  "• اونر ضبط";

const AstaPlugin = {
  command: "اونر",
  description: "إدارة الـ Owner",
  usage: "اونر [ اضف | ازل | عرض | ضبط ] [ منشن | رد | رقم ]",
  category: "المطورين",
  elite: "off",
  group: false,
  prv: false,
  lock: "off",
  dev: "on",
  requiredLevel: "owner",
  asta: "on",
};

// حماية لاستدعاء دوال المطور الأساسي - تعتمد مباشرة على handlers/permissions.js
// (السبب الأصلي للعطل "sock.getOwners is not a function" هو أن إدارة الـ Owners
// كانت تحاول أولاً استدعاء دوال غير موجودة أصلاً على sock - الآن تُستدعى
// دوال permissions.js مباشرة دون أي محاولة وسيطة على sock).
function isIdHardcodedOwner(id) {
  if (!id) return false;
  return id.endsWith("@lid")
    ? permissions.isHardcodedOwner({ lid: id })
    : permissions.isHardcodedOwner({ pn: id });
}

async function fetchOwners() {
  return permissions.getOwners();
}

async function addNewOwners(sock, idsToAdd) {
  return permissions.addOwner({ sock, ids: idsToAdd });
}

async function removeOwners(sock, idsToRemove) {
  return permissions.rmOwner({ sock, ids: idsToRemove });
}

async function resetAllOwners() {
  return permissions.ownerReset();
}

async function resolveTargetIds({ sock, msg, args }) {
  let ids = (await sock.replyedJid(msg)) || (await sock.mentionnedJids(msg));

  if ((!ids || ids.length === 0) && args[1]) {
    const number = args[1].replace(/[^0-9]/g, "");

    if (number.length > 5) {
      const tempJid = number + "@s.whatsapp.net";
      const check = await sock.onWhatsApp(tempJid);

      if (check && check[0]?.exists) {
        ids = [check[0].jid];
      } else {
        return { error: "❌ هذا الرقم غير مسجل في واتساب." };
      }
    }
  }

  return { ids };
}

async function execute({ sock, msg, args, sender }) {
  const chatId = msg.key.remoteJid;
  const action = args[0];

  if (!action) {
    return sock.sendMessage(chatId, { text: usageMessage }, { quoted: msg });
  }

  // الأمر: عرض
  if (action === "عرض") {
    const owners = await fetchOwners(sock);

    // ملاحظة: permissions.getOwners() بترجع null في حالتين لازم نفرّق
    // بينهم: (1) لسه مفيش Owners اتضافوا خالص - حالة طبيعية جدًا، و(2) عطل
    // برمجي حقيقي. بما إن fetchOwners() بقت بتستدعي permissions.js مباشرة
    // (الدالة دايمًا موجودة، مفيش بحث احتياطي على sock تاني)، فـ null هنا
    // معناها الوحيد إن قائمة الـ Owners فاضية - مش إن الدالة مفقودة.
    if (!owners || owners.length === 0) {
      return sock.sendMessage(chatId, { text: "لا يوجد Owners إضافيين حالياً." }, { quoted: msg });
    }

    let text = "👑 *قائمة الـ Owners:*\n\n";
    let mentions = [];
    for (const id of owners) {
      text += `• @${id.split("@")[0]}\n`;
      mentions.push(id);
    }
    return sock.sendMessage(chatId, { text: text.trim(), mentions }, { quoted: msg });
  }

  // التحقق من الصلاحيات للأوامر الإدارية (اضف، ازل، ضبط)
  if (!permissions.isHardcodedOwner({ pn: sender?.pn, lid: sender?.lid })) {
    if (typeof telemetry !== "undefined") {
      telemetry.recordSecurity(
        `CMD: اونر ${action}\nUSER: ${sender?.pn || sender?.lid || "unknown"}\nCHAT: ${chatId}\nREASON: attempted_owner_management_without_hardcoded_owner`
      );
    }
    return sock.sendMessage(
      chatId,
      { text: "🚫 هذا الأمر محصور بالـ Owner/Developer الأساسي فقط." },
      { quoted: msg }
    );
  }

  switch (action) {
    case "اضف": {
      const resolved = await resolveTargetIds({ sock, msg, args });
      if (resolved.error) {
        return sock.sendMessage(chatId, { text: resolved.error }, { quoted: msg });
      }
      const ids = resolved.ids;
      if (!ids || ids.length === 0) {
        return sock.sendMessage(chatId, { text: "يرجى عمل منشن، رد، أو كتابة الرقم بجانب الأمر." }, { quoted: msg });
      }

      let mess_add = "*إضافة Owners*\n\n";
      let mentions = [];
      const successIds = [];
      const alreadyHardcoded = [];
      const idsToAdd = [];

      for (const id of ids) {
        if (isIdHardcodedOwner(id)) {
          alreadyHardcoded.push(id);
          continue;
        }
        idsToAdd.push(id);
      }

      const res_add = idsToAdd.length ? await addNewOwners(sock, idsToAdd) : { success: [], fail: [] };

      // التحقق من وجود الدالة
      if (res_add === null) {
        return sock.sendMessage(chatId, { text: "❌ خطأ برمجي: دالة إضافة الأونر (`addOwner`) مفقودة في ملفات النظام." }, { quoted: msg });
      }

      if (res_add.success && res_add.success.length > 0) {
        mess_add += "✅ *تمت الإضافة بنجاح:*\n";
        for (const user of res_add.success) {
          mess_add += `> @${user.id.split("@")[0]}\n`;
          mentions.push(user.id);
          successIds.push(user.id);
        }
      }

      if (alreadyHardcoded.length > 0 || (res_add.fail && res_add.fail.length > 0)) {
        if (mentions.length > 0) mess_add += "\n";
        mess_add += "⚠️ *تنبيه:*\n";
        for (const id of alreadyHardcoded) {
          mess_add += `• العضو @${id.split("@")[0]} Owner أساسي (Developer) بالفعل.\n`;
          mentions.push(id);
        }
        for (const user of res_add.fail || []) {
          if (user.error === "exist_already") {
            mess_add += `• العضو @${user.id.split("@")[0]} هو Owner بالفعل.\n`;
          } else {
            mess_add += `• فشل @${user.id.split("@")[0]}: ${user.error || "غير معروف"}\n`;
          }
          mentions.push(user.id);
        }
      }

      if (successIds.length > 0 && typeof telemetry !== "undefined") {
        telemetry.recordGeneral(`[OWNER ADDED]\nBY: ${sender?.pn || sender?.lid}\nIDS: ${successIds.join(", ")}`);
      }

      return sock.sendMessage(chatId, { text: mess_add.trim(), mentions });
    }

    case "ازل": {
      const resolved = await resolveTargetIds({ sock, msg, args });
      if (resolved.error) {
        return sock.sendMessage(chatId, { text: resolved.error }, { quoted: msg });
      }
      const ids = resolved.ids;
      if (!ids || ids.length === 0) {
        return sock.sendMessage(chatId, { text: "يرجى عمل منشن، رد، أو كتابة الرقم بجانب الأمر." }, { quoted: msg });
      }

      let mess_rm = "*إزالة Owners*\n\n";
      let mentions = [];
      const removedIds = [];
      const protectedIds = [];
      const idsToRemove = [];

      for (const id of ids) {
        if (isIdHardcodedOwner(id)) {
          protectedIds.push(id);
          continue;
        }
        idsToRemove.push(id);
      }

      const res_rm = idsToRemove.length ? await removeOwners(sock, idsToRemove) : { success: [], fail: [] };

      // التحقق من وجود الدالة
      if (res_rm === null) {
        return sock.sendMessage(chatId, { text: "❌ خطأ برمجي: دالة إزالة الأونر (`rmOwner`) مفقودة في ملفات النظام." }, { quoted: msg });
      }

      if (res_rm.success && res_rm.success.length > 0) {
        mess_rm += "✅ *تمت الإزالة بنجاح:*\n";
        for (const user of res_rm.success) {
          mess_rm += `> @${user.id.split("@")[0]}\n`;
          mentions.push(user.id);
          removedIds.push(user.id);
        }
      }

      if (protectedIds.length > 0 || (res_rm.fail && res_rm.fail.length > 0)) {
        if (mentions.length > 0) mess_rm += "\n";
        mess_rm += "⚠️ *تنبيه:*\n";
        for (const id of protectedIds) {
          mess_rm += `• العضو @${id.split("@")[0]} هو Owner/Developer أساسي محمي ولا يمكن إزالته.\n`;
          mentions.push(id);
          if (typeof telemetry !== "undefined") {
            telemetry.recordSecurity(`CMD: اونر ازل\nUSER: ${sender?.pn || sender?.lid || "unknown"}\nCHAT: ${chatId}\nREASON: attempted_removal_of_hardcoded_owner\nTARGET: ${id}`);
          }
        }
        for (const user of res_rm.fail || []) {
          if (user.error === "not_exist") {
            mess_rm += `• العضو @${user.id.split("@")[0]} مش Owner أصلاً.\n`;
          } else {
            mess_rm += `• فشل @${user.id.split("@")[0]}: ${user.error || "غير معروف"}\n`;
          }
          mentions.push(user.id);
        }
      }

      if (removedIds.length > 0 && typeof telemetry !== "undefined") {
        telemetry.recordGeneral(`[OWNER REMOVED]\nBY: ${sender?.pn || sender?.lid}\nIDS: ${removedIds.join(", ")}`);
      }

      return sock.sendMessage(chatId, { text: mess_rm.trim(), mentions });
    }

    case "ضبط": {
      const res_reset = await resetAllOwners(sock);
      
      // التحقق من وجود الدالة
      if (res_reset === null) {
        return sock.sendMessage(chatId, { text: "❌ خطأ برمجي: دالة تصفير الأونرز (`ownerReset`) مفقودة في ملفات النظام." }, { quoted: msg });
      }

      if (typeof telemetry !== "undefined") {
        telemetry.recordGeneral(`[OWNER RESET]\nBY: ${sender?.pn || sender?.lid}`);
      }
      return sock.sendMessage(
        chatId,
        {
          text:
            "✅ تم تصفير قائمة الـ Owners الإضافيين بنجاح.\n" +
            "ℹ️ الـ Owner/Developer الأساسي لم يتأثر.",
        },
        { quoted: msg }
      );
    }

    default: {
      return sock.sendMessage(chatId, { text: usageMessage }, { quoted: msg });
    }
  }
}

export default { AstaPlugin, execute };
