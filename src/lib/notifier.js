import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
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
