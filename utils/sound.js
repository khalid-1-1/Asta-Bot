import { exec } from 'child_process';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const soundsDir = path.join(__dirname, '..', 'asta', 'sounds');

export const SOUND = {
  LOGOUT: path.join(soundsDir, 'LOGGOUT.mp3'),
  ERROR: path.join(soundsDir, 'ERROR.mp3'),
  OK: path.join(soundsDir, 'OK.mp3'),
};

export function play(file) {
  try {
    if (fs.existsSync(file)) {
      // Stage 9, item #8 (Process / Child Process Safety) - these are
      // short local sound-effect clips; anything still running after 15s
      // is stuck, not playing, and is force-killed rather than left to
      // linger.
      exec(`mpv --no-terminal --really-quiet "${file}"`, { timeout: 15_000, killSignal: 'SIGKILL' });
    }
  } catch {}
}

export function playError() {
  play(SOUND.ERROR);
}

export function playLogout() {
  play(SOUND.LOGOUT);
}

export function playOK() {
  play(SOUND.OK);
}