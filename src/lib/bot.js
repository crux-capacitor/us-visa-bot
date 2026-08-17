import { VisaHttpClient } from './client.js';
import { sendSmsNotification } from './notifier.js';
import { log } from './utils.js';

export class Bot {
  constructor(config, options = {}) {
    this.config = config;
    this.dryRun = options.dryRun || false;
    this.client = new VisaHttpClient(this.config.countryCode, this.config.email, this.config.password);
  }

  async initialize() {
    log('Initializing visa bot...');
    return await this.client.login();
  }

  async checkAvailableDate(sessionHeaders, currentBookedDate, earliestAcceptableDate) {
    const dates = await this.client.checkAvailableDate(
      sessionHeaders,
      this.config.scheduleId,
      this.config.facilityId
    );

    if (!dates || dates.length === 0) {
      log("no dates available");
      return null;
    }

    // Filter dates that are better than current booked date and not before the
    // earliest acceptable date
    const goodDates = dates.filter(date => {
      if (date >= currentBookedDate) {
        log(`date ${date} is further than already booked (${currentBookedDate})`);
        return false;
      }

      if (earliestAcceptableDate && date < earliestAcceptableDate) {
        log(`date ${date} is before earliest acceptable date (${earliestAcceptableDate})`);
        return false;
      }

      return true;
    });

    if (goodDates.length === 0) {
      log("no good dates found after filtering");
      return null;
    }

    // Sort dates and return the earliest one
    goodDates.sort();
    const earliestDate = goodDates[0];
    
    log(`found ${goodDates.length} good dates: ${goodDates.join(', ')}, using earliest: ${earliestDate}`);
    return earliestDate;
  }

  async bookAppointment(sessionHeaders, date) {
    const time = await this.client.checkAvailableTime(
      sessionHeaders,
      this.config.scheduleId,
      this.config.facilityId,
      date
    );

    if (!time) {
      log(`no available time slots for date ${date}`);
      return false;
    }

    if (this.dryRun) {
      log(`[DRY RUN] Would book appointment at ${date} ${time} (not actually booking)`);

      // Only fires when both dry-run mode is on AND NOTIFY_PHONE_NUMBER is set -
      // sendSmsNotification() itself also no-ops if the number is missing, but
      // checking here keeps the intent explicit and avoids an unnecessary
      // await/log-noise when notifications aren't configured at all.
      if (this.config.notifyPhoneNumber) {
        await sendSmsNotification(
          this.config.notifyPhoneNumber,
          `[US Visa Bot - DRY RUN] Appointment available ${date} ${time}. Would have booked automatically - dry-run mode is on, so no booking was made.`,
          this.config.awsRegion
        );
      }

      return true;
    }

    await this.client.book(
      sessionHeaders,
      this.config.scheduleId,
      this.config.facilityId,
      date,
      time
    );

    log(`booked time at ${date} ${time}`);
    return true;
  }

}
