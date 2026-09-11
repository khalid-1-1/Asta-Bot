import { delay } from "@whiskeysockets/baileys";
import chalk from "chalk";

const activeGames = new Map();
const gameTimers = new Map();
// Stage 5, item #7 (Duplicate Execution / Reconnect): this used to be a
// plain boolean, set once and never reset. Baileys hands out a brand new
// `sock` (with a brand new `sock.ev` event emitter) on every reconnect, so
// a boolean guard meant the listener silently stayed attached to the OLD,
// dead emitter after a reconnect - XO simply stopped responding until a
// process restart. Tracking the actual `sock.ev` reference instead means
// we only skip re-attaching when it's genuinely the same, still-live
// emitter, and we correctly re-attach (without ever double-attaching) once
// per new connection.
let attachedEv = null;

// Stage 5, item #3 (Game Sessions): additive idle-timeout only - a game
// that nobody finishes (no move, no surrender, no ".اكس الغاء") used to
// stay in `activeGames` forever. Board/turn/winner logic is untouched.
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

function clearIdleTimer(chatId) {
    const t = gameTimers.get(chatId);
    if (t) clearTimeout(t);
    gameTimers.delete(chatId);
}

function scheduleIdleTimeout(sock, chatId) {
    clearIdleTimer(chatId);
    gameTimers.set(chatId, setTimeout(() => {
        activeGames.delete(chatId);
        gameTimers.delete(chatId);
        sock.sendMessage(chatId, { text: "⌛ تم إنهاء لعبة XO تلقائيًا لعدم وجود نشاط." }).catch(() => {});
    }, IDLE_TIMEOUT_MS));
}

const AstaPlugin = {
    command: "اكس",
    description: "لعبة XO الكلاسيكية (مع صديق أو ضد البوت)",
    usage: "اكس [@منشن | بوت]",
    elite: "off",
    group: true,
    prv: false,
    lock: "off",
  dev: "off",
};

const getIdType = (id) => {
    if (!id) return "Unknown";
    if (id.includes("@lid")) return "LID (Hash)";
    if (id.includes("@s.whatsapp.net")) return "JID (Phone)";
    return "Unknown";
};

const normalizeJID = (jid) => {
    if (!jid) return "";
    let clean = jid.split(':')[0];
    if (clean.includes('@lid')) return clean;
    return clean.includes('@s.whatsapp.net') ? clean : `${clean}@s.whatsapp.net`;
};

function logMove(chatId, incomingID, playerObj, move, status, reason = "") {
    console.log(chalk.gray("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
    console.log(chalk.yellow.bold(`🎮 XO GAME ACTION [${chatId.split('@')[0]}]`));
    console.log(chalk.gray("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
    console.log(chalk.cyan(`📥 Sender Raw: `) + incomingID);
    console.log(chalk.cyan(`🔍 ID Type:    `) + getIdType(incomingID));
    if (playerObj) {
        console.log(chalk.green(`👤 Matched As: `) + `Player (${playerObj.mark})`);
        console.log(chalk.green(`🏷️ Stored JID: `) + playerObj.pn);
    } else {
        console.log(chalk.red(`👤 Identity:   `) + "NO MATCH FOUND (Ignored)");
    }
    if (move) console.log(chalk.blue(`🎲 Move Input: `) + move);
    if (status === "SUCCESS") {
        console.log(chalk.bgGreen.black(` ✅ STATUS: VALID MOVE `));
    } else {
        console.log(chalk.bgRed.white(` ❌ STATUS: REJECTED `) + ` (${reason})`);
    }
    console.log(chalk.gray("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"));
}

class TicTacToe {
    constructor(p1Data, p2Data) {

        this.board = Array(9).fill(null);

        this.playersData = {
            '❎': { ...p1Data, mark: '❎' },
            '⭕': { ...p2Data, mark: '⭕' }
        };

        
        if (p2Data.pn === "BOT") {
            this.turn = '❎';
        } else {
            
            this.turn = Math.random() < 0.5 ? '❎' : '⭕';
        }

        this.winner = null;
    }

    isTurn(incomingID) {
        const currentPlayer = this.playersData[this.turn];
        const normalizedIncoming = normalizeJID(incomingID);

        return currentPlayer.pn === normalizedIncoming ||
            (currentPlayer.lid && currentPlayer.lid === normalizedIncoming);
    }

    identifyPlayer(incomingID) {
        const normalizedIncoming = normalizeJID(incomingID);
        if (this.playersData['❎'].pn === normalizedIncoming || (this.playersData['❎'].lid && this.playersData['❎'].lid === normalizedIncoming)) return this.playersData['❎'];
        if (this.playersData['⭕'].pn === normalizedIncoming || (this.playersData['⭕'].lid && this.playersData['⭕'].lid === normalizedIncoming)) return this.playersData['⭕'];
        return null;
    }

    play(index) {
        if (this.winner || this.board[index]) return false;
        this.board[index] = this.turn;
        this.checkWinner();
        this.turn = this.turn === '❎' ? '⭕' : '❎';
        return true;
    }
    checkWinner() {
        const wins = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
        for (const [a, b, c] of wins) {
            if (this.board[a] && this.board[a] === this.board[b] && this.board[a] === this.board[c]) {
                this.winner = this.board[a];
                return;
            }
        }
        if (this.board.every(cell => cell !== null)) this.winner = 'draw';
    }
    botMove() {
        const available = this.board.map((v, i) => v ? null : i).filter(i => i !== null);
        if (available.length === 0) return;
        for (let i of available) {
            this.board[i] = '⭕'; this.checkWinner();
            if (this.winner === '⭕') { this.winner = null; this.board[i] = null; this.play(i); return; }
            this.winner = null; this.board[i] = null;
        }
        for (let i of available) {
            this.board[i] = '❎';
            let blocked = false;
            const wins = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
            for(let w of wins) if(this.board[w[0]]=='❎' && this.board[w[1]]=='❎' && this.board[w[2]]=='❎') blocked=true;
            this.board[i] = null;
            if (blocked) { this.play(i); return; }
        }
        this.play(available[Math.floor(Math.random() * available.length)]);
    }
}

async function sendBoard(sock, jid, game, quotedMsg) {
    const nums = {1:'1️⃣',2:'2️⃣',3:'3️⃣',4:'4️⃣',5:'5️⃣',6:'6️⃣',7:'7️⃣',8:'8️⃣',9:'9️⃣'};
    const map = game.board.map((v, i) => v ? v : nums[i + 1]);
    const p1Raw = normalizeJID(game.playersData['❎'].pn);
    const p2Raw = game.playersData['⭕'].pn === 'BOT' ? 'BOT' : normalizeJID(game.playersData['⭕'].pn);
    let text = `🎮 *𝑲𝑯𝑨𝑳𝑰𝑫 𝑩𝑶𝑻 𝑲𝑼𝑹𝑨𝑴𝑨  𝕏𝕆*\n\n`;
    text += `❎ : @${p1Raw.split('@')[0]}\n`;
    text += `⭕ : ${p2Raw === 'BOT' ? '🤖 البوت' : '@' + p2Raw.split('@')[0]}\n\n`;
    text += `${map[0]} ${map[1]} ${map[2]}\n${map[3]} ${map[4]} ${map[5]}\n${map[6]} ${map[7]} ${map[8]}\n\n`;
    if (game.winner) {
        if (game.winner === 'draw') {
            text += `🤝 *تعادل!*`;
        } else {
            const winnerJID = game.playersData[game.winner].pn;
            text += `🏆 *الفائز:* ${winnerJID === 'BOT' ? '🤖 البوت' : '@' + normalizeJID(winnerJID).split('@')[0]}`;
        }
        activeGames.delete(jid);
        clearIdleTimer(jid);
    } else {
        const turnJID = game.playersData[game.turn].pn;
        text += `⏳ *الدور:* ${turnJID === 'BOT' ? '🤖 البوت' : '@' + normalizeJID(turnJID).split('@')[0]}\n`;
        text += `🏳 اكتب *استسلام* لانهاء اللعبة.`;
    }
    const mentions = [p1Raw, p2Raw].filter(id => id !== 'BOT' && id !== null);
    await sock.sendMessage(jid, { text, mentions }, { quoted: quotedMsg });
}

function attachGameListener(sock) {
    if (attachedEv === sock.ev) return;
    attachedEv = sock.ev;
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message) return;
        const chatId = msg.key.remoteJid;
        const game = activeGames.get(chatId);
        if (!game) return;
        const body = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || "").trim();
        let senderID;
        if (msg.key.fromMe) {
            senderID = sock.user.id; 
        } else {
            senderID = msg.key.participant || msg.key.remoteJid;
        }
        senderID = normalizeJID(senderID);
        if (body === ".اكس الغاء" || body === ".xo الغاء") {
            activeGames.delete(chatId);
            clearIdleTimer(chatId);
            await sock.sendMessage(chatId, { text: "🛑 تم إنهاء اللعبة." });
            return;
        }
        const identifiedPlayer = game.identifyPlayer(senderID);
        if (body === "استسلام" && identifiedPlayer) {
            const surrenderMark = identifiedPlayer.mark;
            const winnerMark = surrenderMark === '❎' ? '⭕' : '❎';
            game.winner = winnerMark;
            const loserName = identifiedPlayer.pn === 'BOT' ? '🤖 البوت' : '@' + normalizeJID(identifiedPlayer.pn).split('@')[0];
            const winnerData = game.playersData[winnerMark];
            const winnerName = winnerData.pn === 'BOT' ? '🤖 البوت' : '@' + normalizeJID(winnerData.pn).split('@')[0];
            let surrenderText = `🏳 *انسحاب!*\n\n`;
            surrenderText += `اللاعب ${loserName} أعلن استسلامه.\n`;
            surrenderText += `🏆 *الفائز:* ${winnerName}`;
            const mentions = [
                identifiedPlayer.pn !== 'BOT' ? normalizeJID(identifiedPlayer.pn) : null, 
                winnerData.pn !== 'BOT' ? normalizeJID(winnerData.pn) : null
            ].filter(Boolean);
            await sock.sendMessage(chatId, { text: surrenderText, mentions });
            activeGames.delete(chatId);
            clearIdleTimer(chatId);
            return;
        }
        if (!/^[1-9]$/.test(body)) return;
        const move = parseInt(body) - 1;
        if (!identifiedPlayer) {
            logMove(chatId, senderID, null, body, "FAILED", "Not a player");
            return;
        }
        if (!game.isTurn(senderID)) {
            logMove(chatId, senderID, identifiedPlayer, body, "FAILED", "Not their turn");
            return;
        }
        const success = game.play(move);
        if (success) {
            logMove(chatId, senderID, identifiedPlayer, body, "SUCCESS");
            if (!game.winner) scheduleIdleTimeout(sock, chatId);
            await sendBoard(sock, chatId, game, msg);
            if (game.winner) return;
            if (game.playersData[game.turn].pn === "BOT") {
                await delay(1000);
                game.botMove();
                await sendBoard(sock, chatId, game, msg);
            }
        } else {
            logMove(chatId, senderID, identifiedPlayer, body, "FAILED", "Cell occupied");
            if (!msg.key.fromMe) {
                await sock.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
            }
        }
    });
    isListenerAttached = true;
    console.log(chalk.magenta.bold("✅ XO Listener Attached"));
}

async function execute({ sock, msg, args, sender }) {
    attachGameListener(sock);
    const jid = msg.chat;
    if (activeGames.has(jid)) {
        return sock.sendMessage(jid, { text: "⚠ توجد لعبة جارية!" }, { quoted: msg });
    }
    const p1Data = {
        pn: normalizeJID(sender.pn),
        lid: sender.lid ? normalizeJID(sender.lid) : null
    };
    let p2Data = null;
    if (args[0] && (args[0] === "بوت" || args[0].toLowerCase() === "bot")) {
        p2Data = { pn: "BOT", lid: "BOT" };
    } else {
        const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
        if (mentioned) {
            p2Data = { pn: normalizeJID(mentioned), lid: null };
        }
    }
    if (!p2Data) {
        return sock.sendMessage(jid, { text: "📌 الاستخدام :\nاكس @ منشن\nاكس بوت" }, { quoted: msg });
    }
    if (p2Data.pn === p1Data.pn) {
            return sock.sendMessage(jid, { text: "❌ لا يمكنك اللعب ضد نفسك!" }, { quoted: msg });
    }
    const newGame = new TicTacToe(p1Data, p2Data);
    activeGames.set(jid, newGame);
    scheduleIdleTimeout(sock, jid);
    console.log(chalk.green(`🎮 New Game: ${p1Data.pn} vs ${p2Data.pn}`));
    await sendBoard(sock, jid, newGame, msg);
}

export default { AstaPlugin, execute };
