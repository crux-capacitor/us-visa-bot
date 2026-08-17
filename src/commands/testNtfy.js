import { sendNtfyNotification } from '../lib/notifier.js';
import { log } from '../lib/utils.js';

/**
 * Standalone command to confirm ntfy push notifications are wired up
 * correctly - independent of the bot's visa credentials/config. No AWS or
 * telecom registration involved: ntfy is a single HTTP POST to a topic
 * name you pick, delivered via the ntfy app (or a self-hosted server).
 */
export async function testNtfyCommand(options) {
  const topic = options.topic || process.env.NTFY_TOPIC;
  const server = options.server || process.env.NTFY_SERVER || 'https://ntfy.sh';

  if (!topic) {
    console.error(
      'No ntfy topic to send to. Set NTFY_TOPIC in your .env, or pass --topic <name>. ' +
        'Pick something hard to guess (e.g. us-visa-bot-<random-string>) - public ntfy.sh ' +
        'topics are unauthenticated, so anyone who knows the topic name can read it.'
    );
    process.exit(1);
  }

  log(`Sending test ntfy notification to ${server}/${topic} ...`);

  const sent = await sendNtfyNotification(
    topic,
    'US Visa Bot: this is a test message confirming ntfy notifications are working.',
    { server, title: 'US Visa Bot test' }
  );

  if (sent) {
    log('Test notification sent successfully - check your phone (make sure you\'re subscribed to this topic in the ntfy app).');
    process.exit(0);
  } else {
    log('Test notification failed to send. Check the error above and that the topic/server are correct.');
    process.exit(1);
  }
}
