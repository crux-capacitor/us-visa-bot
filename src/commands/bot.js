import { Bot } from '../lib/bot.js';
import { getConfig } from '../lib/config.js';
import { log, sleep, isSocketHangupError } from '../lib/utils.js';

const COOLDOWN = 3600; // 1 hour in seconds

export async function botCommand(options) {
  if (!options.current) {
    console.error('error: required option \'-c, --current <date>\' not specified');
    process.exit(1);
  }

  const config = getConfig();
  const bot = new Bot(config, { dryRun: options.dryRun });
  let currentBookedDate = options.current;
  const latestDate = options.latest;
  const earliestDate = options.earliest;

  log(`Initializing with current date ${currentBookedDate}`);

  if (options.dryRun) {
    log(`[DRY RUN MODE] Bot will only log what would be booked without actually booking`);
  }

  if (latestDate) {
    log(`Latest acceptable date: ${latestDate}`);
  }

  if (earliestDate) {
    log(`Earliest acceptable date: ${earliestDate}`);
  }

  if (config.heartbeatIntervalSeconds) {
    log(`"Still alive" heartbeat notifications every ${config.heartbeatIntervalSeconds} seconds`);
  }

  // sessionHeaders is (re)established inside the loop rather than once up
  // front, and errors are caught per-iteration rather than by recursing into
  // botCommand() on failure. This keeps the same `bot` instance alive across
  // session/auth retries - important because Bot tracks heartbeat timing
  // (lastHeartbeatAt) on itself. The old recursive-retry version constructed
  // a fresh Bot on every retry, which reset the heartbeat clock to zero each
  // time - if errors happened more often than the heartbeat interval (common,
  // since these sessions periodically need re-auth), the heartbeat would
  // never accumulate enough time to fire at all.
  let sessionHeaders = null;

  while (true) {
    try {
      if (!sessionHeaders) {
        sessionHeaders = await bot.initialize();
      }

      await bot.sendHeartbeatIfDue(currentBookedDate, earliestDate, latestDate);

      const availableDate = await bot.checkAvailableDate(
        sessionHeaders,
        currentBookedDate,
        earliestDate,
        latestDate
      );

      if (availableDate) {
        const booked = await bot.bookAppointment(sessionHeaders, availableDate);

        if (booked) {
          // Update current date to the new available date
          currentBookedDate = availableDate;

          if (latestDate && availableDate <= latestDate) {
            log(`Latest acceptable date reached! Successfully booked appointment on ${availableDate}`);
            process.exit(0);
          }
        }
      }

      await sleep(config.refreshDelay);
    } catch (err) {
      // Force re-login on the next iteration, but keep the same bot/loop
      // state (heartbeat timer, currentBookedDate) intact.
      sessionHeaders = null;

      if (isSocketHangupError(err)) {
        log(`Socket hangup error: ${err.message}. Trying again after ${COOLDOWN} seconds...`);
        await sleep(COOLDOWN);
      } else {
        log(`Session/authentication error: ${err.message}. Retrying immediately...`);
      }
    }
  }
}
