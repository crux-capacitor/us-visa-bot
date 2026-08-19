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

    // This Rails app redirects away from the booking form on a successful
    // reschedule (e.g. to the schedule's actions page), but re-renders the
    // same form in place - same URL, still HTTP 200 - when the booking is
    // rejected (session hiccup, validation error, someone else took the
    // slot first, etc). A 200 with no redirect is therefore NOT success,
    // even though the request itself didn't throw - without this check, a
    // rejected booking looks identical to a confirmed one and gets reported
    // as "rescheduled" when nothing actually changed.
    if (!response.redirected) {
      const html = await response.text();
      const flashMessage = this._extractFlashMessage(html);
      throw new Error(
        `Booking was not confirmed - the site re-rendered the booking form instead of redirecting to a confirmation page${flashMessage ? `: "${flashMessage}"` : ' (no error message found on the page)'}`
      );
    }

    return response;
  }

  // Best-effort extraction of a Rails flash/alert message from the
  // re-rendered booking form, purely for a more useful error log line - the
  // redirect check above is what actually determines success/failure.
  _extractFlashMessage(html) {
    const $ = cheerio.load(html);
    const flash = $('.flash, .alert, #flash, .error, .notice').first().text().trim();
    return flash || null;
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
