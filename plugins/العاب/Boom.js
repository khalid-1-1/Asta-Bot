const sessions = new Map();
const listeners = new Map();

export const AstaPlugin = {
command: ["قنبلة", "الغغاء" , "قنبله"],
description: "لعبة القنبلة بين اللاعبين 💣",
elite: "off",
group: true,
prv: false,
lock: "off",
  dev: "off",
};


function getStartTime(count) {
if (count >= 30) return 50;
if (count >= 15) return 35;
if (count >= 8) return 25;
if (count >= 4) return 20;
return 15;
}

async function execute({ sock, msg }) {
const chatId = msg.key.remoteJid;

const text =
msg.message?.conversation ||
msg.message?.extendedTextMessage?.text ||
"";

const cleanText = text.trim().toLowerCase();


if (cleanText === "الغغاء" || cleanText === "إلغاء") {
if (!sessions.has(chatId)) {
return sock.sendMessage(chatId, {
text: "❌ مفيش لعبة شغالة"
});
}

endGame(chatId, sock);  

return sock.sendMessage(chatId, {  
  text: "🛑 تم إلغاء اللعبة"  
});

}


if (sessions.has(chatId)) {
return sock.sendMessage(chatId, {
text: "⚠️ فيه لعبة شغالة بالفعل"
});
}

sessions.set(chatId, {
state: "JOIN",
players: [],
current: null,
time: 0,
timer: null,
warnTimer: null
});


await sock.sendMessage(chatId, {
text: "*💣 لعبة القنبلة 💣*\n\n" +
"*اللعبة جماعية وسريعة 👥🔥*\n\n" +
"*📌 طريقة اللعب :*\n‌‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏  ‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏" +
"*1️⃣ اكتب شارك عشان تدخل اللعب قبل 30 ث*\n" +
"*2️⃣ بعد ما العدد يكمل، اللعبة تبدأ تلقائي*\n" +
"*3️⃣ القنبلة هتكون مع لاعب عشوائي 💣*\n" +
"*4️⃣ اللاعب لازم يمرر القنبلة لشخص تاني عن طريق منشن @ بسرعة*\n" +
"*5️⃣ لو القنبلة انفجرت عندك… تخرج من اللعبة 💥❌*\n\n" +
"*🏆 آخر لاعب يفضل هو الفائز!*\n\n" +
"*⚠️ خد بالك :*\n" +
"*القنبلة ليها وقت محدود… وكل جولة الوقت بيقل ⏳😈*\n\n" +
"*💡 السرعة والتركيز هم سلاحك!*"
});


const listener = async ({ messages }) => {
const m = messages[0];
if (!m.message) return;
if (m.key.remoteJid !== chatId) return;

const sender = m.key.participant || m.key.remoteJid;
if (!sender) return;  

const text =  
  m.message?.conversation ||  
  m.message?.extendedTextMessage?.text ||  
  "";  

const cleanText = text.trim().toLowerCase();  

const session = sessions.get(chatId);  
if (!session) return;  


if (session.state === "JOIN") {  
  if (cleanText === "شارك") {  
    if (!session.players.includes(sender)) {  
      session.players.push(sender);  

      sock.sendMessage(chatId, {  
        text: `*✅ @${sender.split("@")[0]} انضم*`,  
        mentions: [sender]  
      });  
    }  
  }  
}  


else if (session.state === "PLAY") {  
  if (sender !== session.current) return;  

  const mentioned =  
    m.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];  

  if (!mentioned) return;  
  if (!session.players.includes(mentioned)) return;  

  session.current = mentioned;  

  sock.sendMessage(chatId, {  
    text: `*القنبلة 💣 راحت لـ* @${mentioned.split("@")[0]}`,  
    mentions: [mentioned]  
  });  
}

};


if (listeners.has(chatId)) {
sock.ev.off("messages.upsert", listeners.get(chatId));
}

listeners.set(chatId, listener);
sock.ev.on("messages.upsert", listener);


setTimeout(async () => {
const session = sessions.get(chatId);
if (!session) return;

if (session.players.length < 2) {  
  sock.sendMessage(chatId, { text: "*❌ عدد اللاعبين قليل، تم إنهاء اللعبة.*" });  
  endGame(chatId, sock);  
  return;  
}  

session.state = "PLAY";  


await sock.sendMessage(chatId, {  
  text: `*👥 اللاعبين:*\n${session.players  
    .map(x => "@" + x.split("@")[0])  
    .join("\n")}`,  
  mentions: session.players  
});  


const countMsg = await sock.sendMessage(chatId, {  
  text: "*⏳ 5*"  
});  

for (let i = 4; i >= 0; i--) {  
  await new Promise(r => setTimeout(r, 1000));  

  await sock.sendMessage(chatId, {  
    text: i === 0 ? "*🚀 بدأت اللعبة 💣*" : `*⏳ ${i}*`,  
    edit: countMsg.key  
  });  
}  


session.current =  
  session.players[Math.floor(Math.random() *session.players.length)];  

session.time = getStartTime(session.players.length);  

sock.sendMessage(chatId, {  
  text: `*💣 القنبلة بدأت مع* @${session.current.split("@")[0]}`,  
  mentions: [session.current]  
});  

startBomb(chatId, sock);

}, 30000);
}


function startBomb(chatId, sock) {
const session = sessions.get(chatId);
if (!session) return;


if (session.timer) clearTimeout(session.timer);
if (session.warnTimer) clearTimeout(session.warnTimer);


session.timer = setTimeout(() => {
explode(chatId, sock);
}, session.time * 1000);
}


async function explode(chatId, sock) {
const session = sessions.get(chatId);
if (!session) return;


const loser = session.current;
session.players = session.players.filter(player => player !== loser);

sock.sendMessage(chatId, {
 text: `*💥 بوووووم!*\n*انفجرت القنبلة في* @${loser.split("@")[0]}\n*وخرج من اللعبة 💀*`,
mentions: [loser]
});


if (session.players.length === 1) {
sock.sendMessage(chatId, {
text: `*🏆 الفائز في اللعبة هو : @${session.players[0].split("@")[0]} 🎉*`,
mentions: [session.players[0]]
});

endGame(chatId, sock);  
return;

}


session.time = Math.max(5, session.time - 2);


session.current =
  session.players[Math.floor(Math.random() * session.players.length)];


await sock.sendMessage(chatId, {
  text: `*👥 اللاعبين المتبقين :*\n${session.players
    .map(x => "@" + x.split("@")[0])
    .join("\n")}`,
  mentions: session.players
});


const countMsg = await sock.sendMessage(chatId, {
  text: "*⏳ 5*"
});

for (let i = 4; i >= 0; i--) {
  await new Promise(r => setTimeout(r, 1000));

  await sock.sendMessage(chatId, {
    text: i === 0 ? "*🚀 بدأت الجولة 💣*" : `*⏳ ${i}*`,
    edit: countMsg.key
  });
}


sock.sendMessage(chatId, {
  text: `*💣 القنبلة مع* @${session.current.split("@")[0]}`,
  mentions: [session.current]
});


startBomb(chatId, sock);
}


function endGame(chatId, sock) {
const session = sessions.get(chatId);

if (session?.timer) {
clearTimeout(session.timer);
}

if (session?.warnTimer) {
clearTimeout(session.warnTimer);
}

if (listeners.has(chatId)) {
sock.ev.off("messages.upsert", listeners.get(chatId));
listeners.delete(chatId);
}

sessions.delete(chatId);
}

export default { AstaPlugin, execute };