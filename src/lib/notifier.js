import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import fetch from 'node-fetch';
import { log } from './utils.js';

// Reused across calls so we're not re-authenticating with AWS on every check.
// On EC2 this picks up credentials automatically from the instance's IAM role -
// no access keys need to be configured anywhere in this project.
let cachedClient = null;

function getClient(region) {
  if (!cachedClient) {
    cachedClient = new SNSClient(region ? { region } : {});
  }
  return cachedClient;
}

/**
 * Sends a direct-to-phone SMS via SNS (no topic/subscription needed).
 * No-ops (returns false) if phoneNumber is falsy, so callers can always
 * call this unconditionally and let the env-var check happen in config.
 */
export async function sendSmsNotification(phoneNumber, message, region) {
  if (!phoneNumber) {
    return false;
  }

  try {
    const client = getClient(region);
    await client.send(
      new PublishCommand({
        PhoneNumber: phoneNumber,
        Message: message,
      })
    );
    log(`Sent SMS notification to ${phoneNumber}`);
    return true;
  } catch (err) {
    // Never let a notification failure take down the polling loop.
    log(`Failed to send SMS notification: ${err.message}`);
    return false;
  }
}

/**
 * Sends a push notification via ntfy (https://ntfy.sh or a self-hosted
 * server) - a single unauthenticated HTTP POST, no AWS/SNS/telecom
 * registration involved. No-ops (returns false) if topic is falsy.
 */
export async function sendNtfyNotification(topic, message, options = {}) {
  if (!topic) {
    return false;
  }

  const server = (options.server || 'https://ntfy.sh').replace(/\/+$/, '');
  const url = `${server}/${encodeURIComponent(topic)}`;

  try {
    const headers = { 'Content-Type': 'text/plain; charset=utf-8' };
    if (options.title) {
      headers['Title'] = options.title;
    }
    if (options.priority) {
      headers['Priority'] = String(options.priority);
    }

    const res = await fetch(url, { method: 'POST', headers, body: message });
    if (!res.ok) {
      log(`Failed to send ntfy notification: HTTP ${res.status} ${res.statusText}`);
      return false;
    }
    log(`Sent ntfy notification to topic '${topic}'`);
    return true;
  } catch (err) {
    log(`Failed to send ntfy notification: ${err.message}`);
    return false;
  }
}
