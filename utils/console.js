import config from '../asta/config.js';
import crypto from 'crypto';

const { colors } = config;

const logger = {
    success(message) {
        console.log(colors.success + '✓ ' + message + colors.reset);
    },

    error(message, error = '') {
        console.error(colors.error + '✗ ' + message + (error ? ': ' + error : '') + colors.reset);
    },

    info(message) {
        console.info(colors.info + 'ℹ ' + message + colors.reset);
    },

    warn(message) {
        console.warn(colors.warn + '⚠ ' + message + colors.reset);
    }
};

export default logger;