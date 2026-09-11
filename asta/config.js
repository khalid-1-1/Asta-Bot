import developer from '../handlers/developer.js';

let prefix = '.';


const config = {
    botName: '𝑲𝒉𝒂𝒍𝒊𝒅',
    version: '1.0.0',
    
    owner: developer.getDeveloperNumbers(),

    defaultPrefix: '.',

    pairing:{
        phone:null,
        code :null,
    },


    botState:{
        bot: "on",
        
        
        mode: "public",
        asta: "on",
    },


    astaInfo: {
    ceiling: "© 𝑲𝑯𝑨𝑳𝑰𝑫",
    name: "𝑲𝒉𝒂𝒍𝒊𝒅 𝐯1",
    description: "𝑲𝒉𝒂𝒍𝒊𝒅 𝑲𝒖𝒓𝒂𝒎𝒂 𝑽𝒆𝒓",
    verification: true,
    media: false
},

    get prefix() {
        return prefix;
    },

    set prefix(newPrefix) {
        if (newPrefix && typeof newPrefix === 'string') {
            prefix = newPrefix;
        }
    },

    allowedGroups: [],

    messages: {
        error: '❌ حدث خطأ أثناء تنفيذ الأمر',
        noPermission: 'ليس لديك صلاحية لاستخدام هذا الأمر',
        groupOnly: 'هذا الأمر متاح فقط في المجموعات',
        ownerOnly: 'هذا الأمر متاح فقط للنخبة',
        notAllowedGroup: 'عذراً، البوت لا يعمل في هذه المجموعة'
    },

    colors: {
        success: '\x1b[38;2;255;255;0m',
        error:   '\x1b[38;2;255;80;120m',
        info:    '\x1b[38;2;140;120;255m',
        warn:    '\x1b[38;2;255;200;0m',
        reset:   '\x1b[0m'
    },
};

export default config;
