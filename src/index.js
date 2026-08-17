#!/usr/bin/env node

import { program } from 'commander';
import { botCommand } from './commands/bot.js';
import { testSmsCommand } from './commands/testSms.js';
import { testNtfyCommand } from './commands/testNtfy.js';

program
  .name('us-visa-bot')
  .description('Automated US visa appointment rescheduling bot')
  .version('0.0.1');

program
  .command('bot')
  .description('Monitor and reschedule visa appointments')
  .requiredOption('-c, --current <date>', 'current booked date')
  .option('-l, --latest <date>', 'latest acceptable date - stop once a date this early or earlier is found')
  .option('-e, --earliest <date>', 'earliest acceptable date - ignore dates before this')
  .option('--dry-run', 'only log what would be booked without actually booking')
  .action(botCommand);

program
  .command('test-sms')
  .description('Send a test SMS via SNS to confirm notifications are working')
  .option('--phone <number>', 'phone number to send to, E.164 format (overrides NOTIFY_PHONE_NUMBER)')
  .option('--region <region>', 'AWS region to publish from (overrides AWS_REGION)')
  .action(testSmsCommand);

program
  .command('test-ntfy')
  .description('Send a test push notification via ntfy to confirm notifications are working')
  .option('--topic <name>', 'ntfy topic to send to (overrides NTFY_TOPIC)')
  .option('--server <url>', 'ntfy server (overrides NTFY_SERVER, defaults to https://ntfy.sh)')
  .action(testNtfyCommand);

// Default command for backward compatibility (running with no subcommand name,
// e.g. `node index.js -c ...`). This is intentionally NOT a requiredOption:
// commander enforces requiredOptions on the root program for every
// invocation, including other subcommands like `test-sms` - so `-c` is
// validated manually inside botCommand() instead, only when it's actually
// needed (i.e. when this default action runs).
program
  .option('-c, --current <date>', 'current booked date')
  .option('-l, --latest <date>', 'latest acceptable date - stop once a date this early or earlier is found')
  .option('-e, --earliest <date>', 'earliest acceptable date - ignore dates before this')
  .option('--dry-run', 'only log what would be booked without actually booking')
  .action(botCommand);

program.parse();
