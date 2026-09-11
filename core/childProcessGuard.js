/**
 * core/childProcessGuard.js
 * -----------------------------------------------------------------------
 * Stage 9, item #8 (Process / Child Process Safety).
 *
 * This does NOT replace any existing `exec`/`execFile` call - it exists
 * so those call sites can opt into a shared, sane set of default safety
 * options (timeout, kill signal, output cap) instead of every plugin
 * re-inventing its own numbers. Nothing here changes what command is
 * run or how its arguments are built; it only bounds how long a child
 * process may run and how much stdout/stderr it may buffer before Node
 * force-kills it.
 *
 * Command-injection safety is a separate, per-call-site concern (already
 * addressed for the yt-dlp download path in Stage 5 by using execFile
 * with an argv array instead of a shell string) and is NOT something a
 * generic wrapper can retroactively fix for a raw `exec(shellString)`
 * call - this module only adds the missing timeout/resource bounds.
 */

const DEFAULT_TIMEOUT_MS = Number.parseInt(process.env.CHILD_PROCESS_TIMEOUT_MS, 10) || 60_000;
const DEFAULT_MAX_BUFFER = Number.parseInt(process.env.CHILD_PROCESS_MAX_BUFFER, 10) || 8 * 1024 * 1024; // 8MB

/**
 * Returns a safe options object to spread into exec()/execFile() calls:
 *   exec(cmd, guardedOptions({ timeout: 120000 }), callback)
 *
 * `overrides` lets a call site raise the timeout for known-slow
 * operations (e.g. a video download) without losing the maxBuffer/
 * killSignal defaults.
 */
export function guardedOptions(overrides = {}) {
    return {
        timeout: DEFAULT_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        maxBuffer: DEFAULT_MAX_BUFFER,
        ...overrides,
    };
}

export const CHILD_PROCESS_DEFAULTS = Object.freeze({
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxBufferBytes: DEFAULT_MAX_BUFFER,
});
