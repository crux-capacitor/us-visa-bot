import { sendSmsNotification } from '../lib/notifier.js';
import { log } from '../lib/utils.js';

/**
 * Standalone command to confirm SNS is wired up correctly - independent of
 * the bot's visa credentials/config, so you can verify notifications work
 * before (or without) setting up the rest of the bot.
 */
export async function testSmsCommand(options) {
  const phoneNumber = options.phone || process.env.NOTIFY_PHONE_NUMBER;
  const region = options.region || process.env.AWS_REGION;

  if (!phoneNumber) {
    console.error(
      'No phone number to send to. Set NOTIFY_PHONE_NUMBER in your .env, or pass --phone <number> (E.164 format, e.g. +15551234567).'
    );
    process.exit(1);
  }

  log(
    `Sending test SMS to ${phoneNumber} (region: ${region || 'auto-detected'})...`
  );

  const sent = await sendSmsNotification(
    phoneNumber,
    'US Visa Bot: this is a test message confirming SNS notifications are working.',
    region
  );

  if (sent) {
    log('Test SMS sent successfully - check your phone.');
    process.exit(0);
  } else {
    log(
      'Test SMS failed to send. Check the error above, that your AWS credentials/IAM role ' +
        'allow sns:Publish, and whether your AWS account/this number needs SNS SMS sandbox approval.'
    );
    process.exit(1);
  }
}
