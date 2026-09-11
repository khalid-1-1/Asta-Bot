export default {
    replyedJid: (msg) => {
    const participant =
      msg?.message?.extendedTextMessage?.contextInfo?.participant;
    return participant ? [participant] : null;
  },
  mentionnedJids: (msg) => {
    const jids = msg?.message?.extendedTextMessage?.contextInfo?.mentionedJid;
    return Array.isArray(jids) && jids.length > 0 ? jids.filter(Boolean) : null;
  },
}