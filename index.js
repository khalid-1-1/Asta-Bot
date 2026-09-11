import { fork } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const colors = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    fg: {
        red: "\x1b[31m",
        green: "\x1b[32m",
        yellow: "\x1b[33m",
        cyan: "\x1b[36m",
        white: "\x1b[37m",
    }
};

const logger = {
    success(message) {
        console.log(colors.fg.green + colors.bright + '✓ ' + message + colors.reset);
    },
    error(message, error = '') {
        console.error(colors.fg.red + colors.bright + '✗ ' + message + (error ? ': ' + error : '') + colors.reset);
    },
    info(message) {
        console.info(colors.fg.cyan + colors.bright + 'ℹ ' + message + colors.reset);
    },
    warn(message) {
        console.warn(colors.fg.yellow + colors.bright + '⚠ ' + message + colors.reset);
    }
};

const maxRetries = 3;
const retryDelay = 5000;

let isRunning = false;

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Single Bot Instance: index.js only supervises main.js (crash recovery /
// clean restart on 'reset'). There is no account manager, no Login/Gateway
// mode, and no per-account env vars - main.js always boots straight into
// the one Khalid Bot instance using the project's own asta/handlers/utils
// folders and its own WhatsApp session under ملف_الاتصال/.
function handleConnection(retry = 0) {
    if (isRunning) return;

    isRunning = true;
    logger.info('🚀 Starting Khalid Bot...');

    const child = fork(join(__dirname, 'main.js'), [], {
        stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
        env: { ...process.env }
    });

    child.on('message', (data) => {
        if (data === 'ready') {
            retry = 0;
            logger.success('✅ Khalid Bot is online!');
        } else if (data === 'reset') {
            logger.warn('🔄 System State Changed. Reloading...');
            child.kill();
            isRunning = false;
            setTimeout(() => handleConnection(0), 1000);
        } else if (data === 'uptime') {
            child.send(process.uptime());
        }
    });

    child.on('exit', async (code) => {
        isRunning = false;

        if (code === 0) {
            logger.info('✅ Bot closed naturally.');
            return;
        }

        if (code === 429) {
            logger.warn('⚠️ Rate limit exceeded, waiting 10 seconds...');
            await delay(10000);
            return handleConnection(retry);
        }

        if (retry < maxRetries) {
            retry++;
            logger.warn(`⚠️ Restarting (${retry}/${maxRetries}) after ${retryDelay / 1000} seconds...`);
            await delay(retryDelay);
            handleConnection(retry);
        } else {
            logger.error('❌ Failed! Error.');
            process.exit(1);
        }
    });

    child.on('error', (err) => {
        isRunning = false;
        logger.error(`❌ Child process error: ${err}`);
        if (retry < maxRetries) {
            retry++;
            setTimeout(() => handleConnection(retry), retryDelay);
        }
    });

    setTimeout(() => {
        if (!child.connected && isRunning) {
            logger.error('❌ Connection failed during timeout (10 seconds)');
            child.kill();
            handleConnection(retry + 1);
        }
    }, 10000);
}

process.on('SIGINT', () => process.exit());

logger.info('Khalid Bot 🌑🩸');
handleConnection();
