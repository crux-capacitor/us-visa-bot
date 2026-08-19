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

    let bookingResult;

    try {
      bookingResult = await this.client.book(
        sessionHeaders,
        this.config.scheduleId,
        this.config.facilityId,
        date,
        time
      );
    } catch (err) {
      // client.book() throws if the site didn't actually confirm the
      // booking (see client.js) - a failed attempt here is expected from
      // time to time (e.g. another bot/user grabbed the slot first) and
      // should NOT be reported as a successful reschedule. Notify with a
      // distinctly different title so it's never confused with a real
      // "rescheduled" notification, then let the caller retry.
      log(`Booking attempt for ${date} ${time} failed: ${err.message}`);

      await this.notify(
        `US Visa Bot: found and attempted to book ${date} ${time}, but the booking was not confirmed (${err.message}). Will keep retrying.`,
        'US Visa Bot - booking attempt failed'
      );

      return false;
    }

    log(`Booking request for ${date} ${time} did not throw - running an independent follow-up check before trusting it`);

    // book()'s own "did it redirect" signal has already been proven
    // unreliable on this site (a rejection can redirect too, not just a
    // confirmation) - so treat that as inconclusive rather than as proof.
    // Instead, make a separate request to re-fetch the appointment page and
    // look for the date we tried to book. This is still a best-effort check
    // (no documentation for this site's exact markup), so a failure to find
    // it means "couldn't confirm", not "confirmed failed".
    let verification = null;

    try {
      verification = await this.client.verifyCurrentAppointmentDate(
        sessionHeaders,
        this.config.scheduleId,
        date
      );
    } catch (err) {
      log(`Follow-up verification request itself failed: ${err.message}`);
    }

    const bookingNote = bookingResult && bookingResult.pageSummary
      ? ` Booking response said: "${bookingResult.pageSummary}"`
      : '';

    if (verification && verification.confirmed) {
      log(`Follow-up check confirmed ${date} on the appointment page.`);

      await this.notify(
        `US Visa Bot: appointment rescheduled to ${date} ${time} - confirmed by an independent follow-up check of the appointment page.${bookingNote}`,
        'US Visa Bot - appointment rescheduled'
      );

      return true;
    }

    // Given two prior false *positives* here, default to NOT claiming
    // success and NOT advancing currentBookedDate/persisted state when the
    // follow-up can't confirm it - safer to keep retrying a possibly-already-
    // successful booking than to silently stop looking, or persist state,
    // on unconfirmed evidence. The tradeoff is a possible false NEGATIVE if
    // this site's page just doesn't contain anything our heuristic
    // recognizes - if that turns out to be the case, share the logged
    // pageSummary below so the matching logic can be corrected with real
    // evidence.
    const pageNote = verification && verification.pageSummary
      ? ` The appointment page currently shows: "${verification.pageSummary}"`
      : '';

    log(`Follow-up check could NOT confirm ${date} on the appointment page - not marking this as a confirmed reschedule.`);

    await this.notify(
      `US Visa Bot: attempted to reschedule to ${date} ${time}, but a follow-up check could not confirm the change went through.${bookingNote}${pageNote} Please verify manually - will keep monitoring.`,
      'US Visa Bot - reschedule uncertain, please verify'
    );

    return false;
  }

}
