async function execute({sock, msg, args, BIDS,sender}) {
    const groupJid = msg.key.remoteJid;
    const react = (emoji) => {
        if (groupJid.endsWith('@g.us')) {
            return sock.sendMessage(groupJid, { react: { text: emoji, key: msg.key } });
        }
        return sock.sendMessage(groupJid, { 
            text: emoji === '✅' ? '✅' : '❌' 
        }, { quoted: msg, ephemeralExpiration: 60 * 60 * 24 });
    };
    try {
        if (!groupJid.endsWith('@g.us')) {
            return await react('❌'); 
        }
        const body = msg.message?.extendedTextMessage?.text ||
                     msg.message?.conversation || '';
        const lower = body.toLowerCase();
        let option = null;
        if (lower.includes('فتح')) option = 'not_announcement';
        else if (lower.includes('قفل')) option = 'announcement';
        if (!option) {
            return await react('❓'); 
        }
        await sock.groupSettingUpdate(groupJid, option);
        return await react('✅'); 
    } catch (error) {
        console.error('✗ خطأ في أمر الشات:', error);
        await react('❌');
    }
}
export const AstaPlugin = {
    command: 'شات',
    description: 'إدارة إعدادات المجموعة (فتح/قفل الدردشة) بصمت.',
    elite: "off",
  requiredLevel: "elite", 
    group: true, 
    prv: false,
    lock: "off",
  dev: "off",
};
export default { AstaPlugin, execute };
