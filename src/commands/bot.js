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

  try {
    const sessionHeaders = await bot.initialize();

    while (true) {
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

          options = {
            ...options,
            current: currentBookedDate
          };

          if (latestDate && availableDate <= latestDate) {
            log(`Latest acceptable date reached! Successfully booked appointment on ${availableDate}`);
            process.exit(0);
          }
        }
      }

      await sleep(config.refreshDelay);
    }
  } catch (err) {
    if (isSocketHangupError(err)) {
      log(`Socket hangup error: ${err.message}. Trying again after ${COOLDOWN} seconds...`);
      await sleep(COOLDOWN);
    } else {
      log(`Session/authentication error: ${err.message}. Retrying immediately...`);
    }
    return botCommand(options);
  }
}
