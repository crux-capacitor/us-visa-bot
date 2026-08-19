import fs from 'fs';
import path from 'path';
import { log } from './utils.js';

// Persists the bot's progress (currently just currentBookedDate) to a small
// JSON file on disk, so it survives process restarts - a crash, a systemd
// restart, a reboot, a manual `systemctl restart` - none of which are rare
// over the days/weeks this bot typically runs. Without this, currentBookedDate
// only ever lives in memory: any restart forgets a real booking and falls
// back to whatever --current/CurrentBookedDate was originally passed in,
// which can cause the bot to try to re-book a slot it already holds.

export function loadState(stateFilePath) {
  if (!stateFilePath || !fs.existsSync(stateFilePath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(stateFilePath, 'utf8');
    const state = JSON.parse(raw);

    if (!state || typeof state.currentBookedDate !== 'string') {
      log(`State file ${stateFilePath} exists but has no valid currentBookedDate - ignoring it.`);
      return null;
    }

    return state;
  } catch (err) {
    log(`Failed to read state file ${stateFilePath}: ${err.message}. Ignoring it.`);
    return null;
  }
}

export function saveState(stateFilePath, state) {
  if (!stateFilePath) {
    return;
  }

  try {
    // Write to a temp file and rename over the real one, so a crash mid-write
    // can never leave a half-written/corrupt state file behind.
    const dir = path.dirname(stateFilePath);
    const tmpPath = path.join(dir, `.${path.basename(stateFilePath)}.tmp-${process.pid}`);

    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2));
    fs.renameSync(tmpPath, stateFilePath);
  } catch (err) {
    log(`Failed to persist state to ${stateFilePath}: ${err.message}. Progress will not survive a restart.`);
  }
}
