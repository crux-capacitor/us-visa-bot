import { VisaHttpClient } from './client.js';
import { sendSmsNotification, sendNtfyNotification } from './notifier.js';
import { log } from './utils.js';

export class Bot {
  constructor(config, options = {}) {
    this.config = config;
    this.dryRun = options.dryRun || false;
    this.client = new VisaHttpClient(this.config.countryCode, this.config.email, this.config.password);
    this.heartbeatIntervalMs = config.heartbeatIntervalSeconds ? config.heartbeatIntervalSeconds * 1000 : null;
    // Baseline is set on the first check rather than at construction, so the
    // first heartbeat fires one full interval after the bot actually starts
    // polling, not one interval after the process happened to be created.
    this.lastHeartbeatAt = null;
  }

  async initialize() {
    log('Initializing visa bot...');
    return await this.client.login();
  }

  async checkAvailableDate(sessionHeaders, currentBookedDate, earliestAcceptableDate, latestAcceptableDate) {
    const dates = await this.client.checkAvailableDate(
      sessionHeaders,
      this.config.scheduleId,
      this.config.facilityId
    );

    if (!dates || dates.length === 0) {
      log("no dates available");
      return null;
    }

    // Filter dates that are better than current booked date and fall within
    // the [earliest, latest] acceptable window
    const goodDates = dates.filter(date => {
      if (date >= currentBookedDate) {
        log(`date ${date} is further than already booked (${currentBookedDate})`);
        return false;
      }

      if (earliestAcceptableDate && date < earliestAcceptableDate) {
        log(`date ${date} is before earliest acceptable date (${earliestAcceptableDate})`);
        return false;
      }

      if (latestAcceptableDate && date > latestAcceptableDate) {
        log(`date ${date} is after latest acceptable date (${latestAcceptableDate})`);
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

  // Fires whichever notification channels are configured - each is
  // independently optional and no-ops on its own if unset, but checking
  // here keeps the intent explicit and avoids unnecessary await/log-noise
  // when a channel isn't configured at all. Shared by both the dry-run and
  // real-booking paths so a rescheduled appointment always notifies the
  // same way a dry-run "would have booked" does.
  async notify(message, title) {
    if (this.config.notifyPhoneNumber) {
      await sendSmsNotification(this.config.notifyPhoneNumber, message, this.config.awsRegion);
    }

    if (this.config.ntfyTopic) {
      await sendNtfyNotification(this.config.ntfyTopic, message, {
        server: this.config.ntfyServer,
        title,
        priority: 4,
      });
    }
  }

  // Sends a "still alive" notification via whichever channel(s) are
  // configured, once per heartbeatIntervalMs. No-ops entirely if
  // HEARTBEAT_INTERVAL wasn't set. Call this once per poll loop iteration -
  // it tracks its own timing internally, so callers don't need to.
  async sendHeartbeatIfDue(currentBookedDate, earliestAcceptableDate, latestAcceptableDate) {
    if (!this.heartbeatIntervalMs) {
      return;
    }

    const now = Date.now();

    if (this.lastHeartbeatAt === null) {
      this.lastHeartbeatAt = now;
      return;
    }

    if (now - this.lastHeartbeatAt < this.heartbeatIntervalMs) {
      return;
    }

    this.lastHeartbeatAt = now;

    log('Sending heartbeat notification');

    let message = `US Visa Bot heartbeat: still running, currently monitoring for dates earlier than ${currentBookedDate}`;

    if (earliestAcceptableDate && latestAcceptableDate) {
      message += ` (between ${earliestAcceptableDate} and ${latestAcceptableDate})`;
    } else if (earliestAcceptableDate) {
      message += ` (no earlier than ${earliestAcceptableDate})`;
    } else if (latestAcceptableDate) {
      message += ` (no later than ${latestAcceptableDate})`;
    }

    message += '.';

    await this.notify(message, 'US Visa Bot - still alive');
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

      await this.notify(
        `[US Visa Bot - DRY RUN] Appointment available ${date} ${time}. Would have booked automatically - dry-run mode is on, so no booking was made.`,
        'US Visa Bot - appointment found (dry run)'
      );

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

    await this.notify(
      `US Visa Bot: appointment rescheduled to ${date} ${time}.`,
      'US Visa Bot - appointment rescheduled'
    );

    return true;
  }

}
