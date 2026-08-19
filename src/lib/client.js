import fetch from "node-fetch";
import cheerio from 'cheerio';
import { log } from './utils.js';
import { getBaseUri } from './config.js';

// Common headers
const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Cache-Control': 'no-store'
};

export class VisaHttpClient {
  constructor(countryCode, email, password) {
    this.baseUri = getBaseUri(countryCode);
    this.email = email;
    this.password = password;
  }

  // Public API methods
  async login() {
    log('Logging in');

    const anonymousHeaders = await this._anonymousRequest(`${this.baseUri}/users/sign_in`)
      .then(response => this._extractHeaders(response));

    const loginData = {
      'utf8': '✓',
      'user[email]': this.email,
      'user[password]': this.password,
      'policy_confirmed': '1',
      'commit': 'Sign In'
    };

    return this._submitForm(`${this.baseUri}/users/sign_in`, anonymousHeaders, loginData)
      .then(res => ({
        ...anonymousHeaders,
        'Cookie': this._extractRelevantCookies(res)
      }));
  }

  async checkAvailableDate(headers, scheduleId, facilityId) {
    const url = `${this.baseUri}/schedule/${scheduleId}/appointment/days/${facilityId}.json?appointments[expedite]=false`;
    
    return this._jsonRequest(url, headers)
      .then(data => data.map(item => item.date));
  }

  async checkAvailableTime(headers, scheduleId, facilityId, date) {
    const url = `${this.baseUri}/schedule/${scheduleId}/appointment/times/${facilityId}.json?date=${date}&appointments[expedite]=false`;
    
    return this._jsonRequest(url, headers)
      .then(data => data['business_times'][0] || data['available_times'][0]);
  }

  async book(headers, scheduleId, facilityId, date, time) {
    const url = `${this.baseUri}/schedule/${scheduleId}/appointment`;

    const bookingHeaders = await this._anonymousRequest(url, headers)
      .then(response => this._extractHeaders(response));

    const bookingData = {
      'utf8': '✓',
      'authenticity_token': bookingHeaders['X-CSRF-Token'],
      'confirmed_limit_message': '1',
      'use_consulate_appointment_capacity': 'true',
      'appointments[consulate_appointment][facility_id]': facilityId,
      'appointments[consulate_appointment][date]': date,
      'appointments[consulate_appointment][time]': time,
      'appointments[asc_appointment][facility_id]': '',
      'appointments[asc_appointment][date]': '',
      'appointments[asc_appointment][time]': ''
    };

    const response = await this._submitFormWithRedirect(url, bookingHeaders, bookingData);

    if (!response.ok) {
      throw new Error(`Booking request failed with HTTP ${response.status}`);
    }

    // NOTE: a redirect away from the booking form is NOT reliable proof of
    // success on its own - it turns out this site can redirect on a
    // rejection too (e.g. back to a listing/notice page), not just re-render
    // the form in place. Since we don't have a fully trustworthy signal from
    // this response alone, we always capture the resulting page's visible
    // text (pageSummary) and surface it all the way up to the notification
    // itself, so a human can look at what the site actually said rather than
    // trusting a heuristic that has already been wrong twice.
    const finalUrl = response.url;
    const html = await response.text();
    const pageSummary = this._extractPageSummary(html);

    log(`Booking response: redirected=${response.redirected}, finalUrl=${finalUrl}`);
    if (pageSummary) {
      log(`Booking response page summary: "${pageSummary}"`);
    }

    if (!response.redirected) {
      throw new Error(
        `Booking was not confirmed - the site re-rendered the booking form instead of redirecting${pageSummary ? `: "${pageSummary}"` : ' (no summary text found on the page)'}`
      );
    }

    return { redirected: response.redirected, finalUrl, pageSummary };
  }

  // Independent ground-truth check: re-fetches the appointment page fresh
  // (a separate request from book() itself) and looks for the date we tried
  // to book somewhere in it. This exists specifically because book()'s own
  // "did it redirect" signal has already been proven unreliable on this site
  // - a rejection can redirect too, not just a confirmation. This is still a
  // best-effort heuristic (we don't have documentation for this site's exact
  // markup), so `confirmed: false` means "couldn't find evidence it worked",
  // not "confirmed it failed" - always paired with pageSummary so a human
  // can judge for themselves from the actual page text.
  async verifyCurrentAppointmentDate(headers, scheduleId, expectedDate) {
    const url = `${this.baseUri}/schedule/${scheduleId}/appointment`;
    const response = await this._anonymousRequest(url, headers);
    const html = await response.text();

    return {
      confirmed: this._pageReferencesDate(html, expectedDate),
      pageSummary: this._extractPageSummary(html)
    };
  }

  // Looks for an ISO date (e.g. "2027-03-08") both literally (it may appear
  // in a hidden input, data attribute, or embedded JSON even if displayed to
  // users differently) and as a handful of common human-readable renderings,
  // since the visible page text is far more likely to show something like
  // "March 8, 2027" than the raw ISO string.
  _pageReferencesDate(html, isoDate) {
    if (html.includes(isoDate)) {
      return true;
    }

    const [year, month, day] = isoDate.split('-').map(Number);
    if (!year || !month || !day) {
      return false;
    }

    const date = new Date(Date.UTC(year, month - 1, day));
    const variants = [
      date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }),
      date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }),
      date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }),
      `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}/${year}`,
      `${month}/${day}/${year}`
    ];

    const lowerHtml = html.toLowerCase();
    return variants.some(variant => lowerHtml.includes(variant.toLowerCase()));
  }

  // Best-effort extraction of readable text from a post-booking response
  // page, for logging and for inclusion in notifications - NOT currently
  // used to determine success/failure on its own (see the comment in book()
  // above). Prefers a Rails flash/alert message if present (most likely to
  // explain a rejection); falls back to the page's general visible text so
  // a real confirmation page's content shows up too.
  _extractPageSummary(html) {
    const $ = cheerio.load(html);

    const flash = $('.flash, .alert, #flash, .error, .notice').first().text().trim();
    if (flash) {
      return this._collapseWhitespace(flash).slice(0, 300);
    }

    const bodyText = $('body').text();
    const collapsed = this._collapseWhitespace(bodyText);
    return collapsed ? collapsed.slice(0, 300) : null;
  }

  _collapseWhitespace(text) {
    return text.replace(/\s+/g, ' ').trim();
  }

  // Private request methods
  async _anonymousRequest(url, headers = {}) {
    return fetch(url, {
      headers: {
        "User-Agent": "",
        "Accept": "*/*",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
        ...headers
      }
    });
  }

  async _jsonRequest(url, headers = {}) {
    return fetch(url, {
      headers: {
        ...headers,
        "Accept": "application/json",
        "X-Requested-With": "XMLHttpRequest"
      },
      cache: "no-store"
    })
      .then(r => r.json())
      .then(r => this._handleErrors(r));
  }

  async _submitForm(url, headers = {}, formData = {}) {
    return fetch(url, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
      },
      body: new URLSearchParams(formData)
    });
  }

  async _submitFormWithRedirect(url, headers = {}, formData = {}) {
    return fetch(url, {
      method: "POST",
      redirect: "follow",
      headers: {
        ...headers,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams(formData)
    });
  }

  // Private utility methods
  async _extractHeaders(res) {
    const cookies = this._extractRelevantCookies(res);
    const html = await res.text();
    const $ = cheerio.load(html);
    const csrfToken = $('meta[name="csrf-token"]').attr('content');

    return {
      ...COMMON_HEADERS,
      "Cookie": cookies,
      "X-CSRF-Token": csrfToken,
      "Referer": this.baseUri,
      "Referrer-Policy": "strict-origin-when-cross-origin"
    };
  }

  _extractRelevantCookies(res) {
    const parsedCookies = this._parseCookies(res.headers.get('set-cookie'));
    return `_yatri_session=${parsedCookies['_yatri_session']}`;
  }

  _parseCookies(cookies) {
    const parsedCookies = {};

    cookies.split(';').map(c => c.trim()).forEach(c => {
      const [name, value] = c.split('=', 2);
      parsedCookies[name] = value;
    });

    return parsedCookies;
  }

  _handleErrors(response) {
    const errorMessage = response['error'];

    if (errorMessage) {
      throw new Error(errorMessage);
    }

    return response;
  }
}
