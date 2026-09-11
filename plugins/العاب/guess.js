const games = new Map();
const listeners = new Map();
const timers = new Map();

// Stage 5, item #3 (Game Sessions): this game previously had no idle
// cleanup at all - if a chat started "تخمين" and never finished (no
// correct guess, no "توققف"), the listener + game state stayed in memory
// forever. This is a bounded, additive timeout only: it does not touch
// the win condition or any existing message/response, it just cleans up
// an abandoned session the same way an explicit "توققف" already does.
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
    games.delete(chatId);
    timers.delete(chatId);
    sock.sendMessage(chatId, {
      text: "⌛ تم إنهاء لعبة التخمين تلقائيًا لعدم وجود نشاط."
    }).catch(() => {});
  }, IDLE_TIMEOUT_MS));
}

export const AstaPlugin = {
  command: ["تخمين", "توققف"],
  description: "لعبة تخمين الرقم من 1 الي 100",
  elite: "off",
  group: false,
  prv: false,
  lock: "off",
  dev: "off",
};

export default {
  AstaPlugin,

  async execute({ sock, msg }) {

    const chatId = msg.key.remoteJid;

    
    if (msg.message?.conversation === "تخمين") {

      if (games.has(chatId)) {
        return sock.sendMessage(chatId, {
          text: "⚠️ اللعبة شغالة بالفعل."
        }, { quoted: msg });
      }

      const number = Math.floor(Math.random() * 100) + 1;

      games.set(chatId, {
        number,
        tries: 0
      });

      await sock.sendMessage(chatId, {
        text: "*🎯 اللعبة بدأت!*\n\n*✍️ اكتب رقم مباشرة بين 0 و 100*"
      }, { quoted: msg });

      const listener = async ({ messages }) => {
        const m = messages[0];
        if (!m.message) return;
        if (m.key.remoteJid !== chatId) return;

        const input =
          m.message?.conversation ||
          m.message?.extendedTextMessage?.text ||
          "";


        if (input === "توققف") {
          sock.ev.off("messages.upsert", listener);
          listeners.delete(chatId);
          games.delete(chatId);
          clearIdleTimer(chatId);

          return sock.sendMessage(chatId, {
            text: "🛑 تم إيقاف اللعبة."
          }, { quoted: m });
        }

        const guess = parseInt(input);
        if (isNaN(guess)) return;

        const game = games.get(chatId);
        if (!game) return;

        game.tries++;

        if (guess === game.number) {
          sock.ev.off("messages.upsert", listener);
          listeners.delete(chatId);
          games.delete(chatId);
          clearIdleTimer(chatId);

          return sock.sendMessage(chatId, {
            text: `🎉 صحيح!\n\n🔢 الرقم: ${game.number}\n📊 المحاولات: ${game.tries}`
          }, { quoted: m });

        } else if (guess < game.number) {

          scheduleIdleTimeout(sock, chatId, listener);
          return sock.sendMessage(chatId, {
            text: "🔼 الرقم أكبر."
          }, { quoted: m });

        } else {

          scheduleIdleTimeout(sock, chatId, listener);
          return sock.sendMessage(chatId, {
            text: "🔽 الرقم أصغر."
          }, { quoted: m });

        }
      };

      
      if (listeners.has(chatId)) {
        sock.ev.off("messages.upsert", listeners.get(chatId));
      }

      listeners.set(chatId, listener);
      sock.ev.on("messages.upsert", listener);
      scheduleIdleTimeout(sock, chatId, listener);
    }
  }
};