const sessions = new Map();
const listeners = new Map();
const timers = new Map();

// Stage 5, item #3 (Game Sessions): additive idle-timeout only - this game
// had no cleanup for an abandoned session (e.g. "رياضيات" started and the
// user never picks a level, or never finishes answering). Win/lose logic,
// attempts counting and messages below are all unchanged.
const IDLE_TIMEOUT_MS = 3 * 60 * 1000;

function clearIdleTimer(chatId) {
  const t = timers.get(chatId);
  if (t) clearTimeout(t);
  timers.delete(chatId);
}

function scheduleIdleTimeout(sock, chatId, listener) {
  clearIdleTimer(chatId);
  timers.set(chatId, setTimeout(() => {
    sock.ev.off("messages.upsert", listener);
    listeners.delete(chatId);
    sessions.delete(chatId);
    timers.delete(chatId);
    sock.sendMessage(chatId, {
      text: "⌛ تم إيقاف لعبة الرياضيات تلقائيًا لعدم وجود نشاط."
    }).catch(() => {});
  }, IDLE_TIMEOUT_MS));
}

export const AstaPlugin = {
  command: ["رياضيات", "توقف"],
  description: "لعبة الرياضيات الذكية بمسائل تلقائية لا تنتهي",
  elite: "off",
  group: false,
  prv: false,
  lock: "off",
  dev: "off",
  asta: "on"
};


function cleanText(text) {
  if (!text) return "";
  return text
    .trim()
    .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
    .toLowerCase();
}


function generateQuestion(level) {
  let q, a;
  
  
  const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

  switch (level) {
    case "4": 
      if (Math.random() > 0.5) {
        let num1 = rand(5, 50);
        let num2 = rand(5, 50);
        q = `${num1} + ${num2}`;
        a = num1 + num2;
      } else {
        let num1 = rand(20, 80);
        let num2 = rand(5, 19);
        q = `${num1} - ${num2}`;
        a = num1 - num2;
      }
      break;

    case "3": 
      let modeMed = rand(1, 3);
      if (modeMed === 1) { 
        let num1 = rand(4, 12);
        let num2 = rand(3, 10);
        q = `${num1} × ${num2}`;
        a = num1 * num2;
      } else if (modeMed === 2) { 
        let num2 = rand(3, 10);
        let num1 = num2 * rand(4, 12); 
        q = `${num1} ÷ ${num2}`;
        a = num1 / num2;
      } else { 
        let num1 = rand(10, 30);
        let num2 = rand(10, 30);
        let num3 = rand(5, 15);
        q = `${num1} + ${num2} - ${num3}`;
        a = num1 + num2 - num3;
      }
      break;

    case "2": 
      let modeHard = rand(1, 2);
      if (modeHard === 1) { 
        let base = rand(4, 15); 
        let num2 = rand(10, 50);
        q = `${base}² - ${num2}`;
        a = (base * base) - num2;
      } else { 
        let num1 = rand(5, 15);
        let num2 = rand(4, 10);
        let num3 = rand(10, 40);
        q = `(${num1} × ${num2}) + ${num3}`;
        a = (num1 * num2) + num3;
      }
      break;

    case "1": 
      let modeLeg = rand(1, 2);
      if (modeLeg === 1) { 
        const roots = [16, 25, 36, 49, 64, 81, 100, 121, 144, 169, 225, 625];
        let rootNum = roots[Math.floor(Math.random() * roots.length)];
        let rootAns = Math.sqrt(rootNum);
        let num2 = rand(10, 30);
        let num3 = rand(2, 5);
        q = `√${rootNum} + (${num2} × ${num3})`;
        a = rootAns + (num2 * num3);
      } else { 
        let num1 = rand(100, 300);
        let num2 = rand(2, 5);
        let num3 = rand(20, 60);
        
        num1 = Math.round(num1 / num2) * num2; 
        q = `(${num1} ÷ ${level === "1" ? num2 : 2}) - ${num3}`;
        a = (num1 / num2) - num3;
      }
      break;
  }

  return { q, a: String(a) };
}

export default {
  AstaPlugin,

  async execute({ sock, msg }) {
    try {
      const chatId = msg.key.remoteJid;
      const sender = msg.key.participant || chatId;

      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        "";

      const input = cleanText(text);

      
      if (input === "رياضيات") {
        if (sessions.has(chatId)) {
          return await sock.sendMessage(
            chatId,
            { text: "⚠️ اللعبة شغالة بالفعل في هذا الشات! اكتب الاختيار أو الحل مباشرة، أو اكتب *توقف* لإنهاء اللعبة." },
            { quoted: msg }
          );
        }

        sessions.set(chatId, {
          state: "choose",
          sender: sender,
          attempts: 0
        });

        await sock.sendMessage(
          chatId,
          {
            text: `🧮 *لعبة الرياضيات الذكية (مسائل متجددة دائماً)*

1️⃣ خرافي
2️⃣ صعب
3️⃣ متوسط
4️⃣ سهل

✍️ ارسل رقم المستوى المطلوب فقط.`
          },
          { quoted: msg }
        );

        
        const listener = async ({ messages }) => {
          try {
            const m = messages[0];
            if (!m.message) return;
            if (m.key.remoteJid !== chatId) return;

            const currentText =
              m.message?.conversation ||
              m.message?.extendedTextMessage?.text ||
              "";

            const currentInput = cleanText(currentText);

            
            if (currentInput === "توقف") {
              sock.ev.off("messages.upsert", listener);
              listeners.delete(chatId);
              sessions.delete(chatId);
              clearIdleTimer(chatId);

              return await sock.sendMessage(
                chatId,
                { text: "🛑 تم إيقاف لعبة الرياضيات بنجاح." },
                { quoted: m }
              );
            }

            const session = sessions.get(chatId);
            if (!session) return;

            
            if (session.state === "choose") {
              if (!["1", "2", "3", "4"].includes(currentInput)) return;

              
              const selected = generateQuestion(currentInput);

              session.state = "answer";
              session.question = selected.q;
              session.answer = cleanText(selected.a);
              sessions.set(chatId, session);
              scheduleIdleTimeout(sock, chatId, listener);

              return await sock.sendMessage(
                chatId,
                {
                  text: `🧮 *المسألة الحسابية:*

🤖 *${selected.q} = ؟*

✍️ أرسل الإجابة الصحيحة بالأرقام فقط.`
                },
                { quoted: m }
              );
            }

            
            if (session.state === "answer") {
              if (currentInput === session.answer) {
                sock.ev.off("messages.upsert", listener);
                listeners.delete(chatId);
                sessions.delete(chatId);
                clearIdleTimer(chatId);

                return await sock.sendMessage(
                  chatId,
                  { text: `✅ *إجابة صحيحة يا عبقري!* 🎉\n\nأحسنت، ذكاء وسرعة مذهلة! 🧠✨` },
                  { quoted: m }
                );
              } else {
                if (isNaN(parseInt(currentInput))) return;

                session.attempts += 1;

                if (session.attempts < 3) {
                  sessions.set(chatId, session); 
                  scheduleIdleTimeout(sock, chatId, listener);
                  return await sock.sendMessage(
                    chatId,
                    { text: `❌ *إجابة خاطئة!* \n\nركز جيداً وحاول مجدداً في المسألة: \n🤖 *${session.question} = ؟*` },
                    { quoted: m }
                  );
                } else {
                  sock.ev.off("messages.upsert", listener);
                  listeners.delete(chatId);
                  sessions.delete(chatId);
                  clearIdleTimer(chatId);

                  return await sock.sendMessage(
                    chatId,
                    { text: `❌ *للأسف إجابة خاطئة للمرة الثالثة!*\n\n✅ الإجابة الصحيحة هي: *${session.answer}*\n\nحظاً أوفق في التحدي القادم! 🦾` },
                    { quoted: m }
                  );
                }
              }
            }

          } catch (internalErr) {
            console.error("Error inside Math Listener:", internalErr);
          }
        };

        if (listeners.has(chatId)) {
          sock.ev.off("messages.upsert", listeners.get(chatId));
        }

        listeners.set(chatId, listener);
        sock.ev.on("messages.upsert", listener);
        scheduleIdleTimeout(sock, chatId, listener);
      }

    } catch (err) {
      console.error("Error in Math Game command:", err);
    }
  }
};