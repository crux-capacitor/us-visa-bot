# US Visa Bot 🤖

An automated bot that monitors and reschedules US visa interview appointments to get you an earlier date.

## Features

- 🔄 Continuously monitors available appointment slots
- 📅 Automatically books earlier dates when found  
- 🎯 Configurable earliest and latest acceptable date constraints
- 🚨 Exits successfully once the latest acceptable date is reached
- 📊 Detailed logging with timestamps
- 🔐 Secure authentication with environment variables

## How It Works

The bot logs into your account on https://ais.usvisa-info.com/ and checks for available appointment dates every few seconds. When it finds a date earlier than your current booking (and within your specified constraints), it automatically reschedules your appointment.

## Prerequisites

- Node.js 16+ 
- A valid US visa interview appointment
- Access to https://ais.usvisa-info.com/

## Installation

1. Clone the repository:
```bash
git clone https://github.com/your-username/us-visa-bot.git
cd us-visa-bot
```

2. Install dependencies:
```bash
npm install
```

## Configuration

Create a `.env` file in the project root with your credentials:

```env
EMAIL=your.email@example.com
PASSWORD=your_password
COUNTRY_CODE=your_country_code
SCHEDULE_ID=your_schedule_id
FACILITY_ID=your_facility_id
REFRESH_DELAY=3

# --- Optional: notifications (see the Notifications section below) ---
NOTIFY_PHONE_NUMBER=
AWS_REGION=us-east-1
NTFY_TOPIC=
NTFY_SERVER=https://ntfy.sh
HEARTBEAT_INTERVAL=
```

### Finding Your Configuration Values

| Variable | Description | How to Find |
|----------|-------------|-------------|
| `EMAIL` | Your login email | Your credentials for ais.usvisa-info.com |
| `PASSWORD` | Your login password | Your credentials for ais.usvisa-info.com |
| `COUNTRY_CODE` | Your country code | Found in URL: `https://ais.usvisa-info.com/en-{COUNTRY_CODE}/` <br>Examples: `br` (Brazil), `fr` (France), `de` (Germany) |
| `SCHEDULE_ID` | Your appointment schedule ID | Found in URL when rescheduling: <br>`https://ais.usvisa-info.com/en-{COUNTRY_CODE}/niv/schedule/{SCHEDULE_ID}/continue_actions` |
| `FACILITY_ID` | Your consulate facility ID | Found in network calls when selecting dates, or inspect the date selector dropdown <br>Example: Paris = `44` |
| `REFRESH_DELAY` | Seconds between checks | Optional, defaults to 3 seconds |
| `NOTIFY_PHONE_NUMBER` | Phone number (E.164, e.g. `+15551234567`) to text via AWS SNS | Optional - see [SMS via AWS SNS](#sms-via-aws-sns) |
| `AWS_REGION` | AWS region SNS should publish from | Optional - only needed for SMS; usually auto-detected on EC2 |
| `NTFY_TOPIC` | ntfy.sh topic name to push notifications to | Optional - see [ntfy push notifications](#ntfy-push-notifications-recommended) |
| `NTFY_SERVER` | ntfy server to publish to | Optional, defaults to `https://ntfy.sh`; only change if self-hosting |
| `HEARTBEAT_INTERVAL` | How often to send a "still alive" notification | Optional - see [`"Still alive" heartbeat`](#still-alive-heartbeat) |

## Usage

Run the bot with your current appointment date:

```bash
node index.js -c <current_date> [-l <latest_date>] [-e <earliest_date>]
```

### Command Line Arguments

| Flag | Long Form | Required | Description |
|------|-----------|----------|-------------|
| `-c` | `--current` | ✅ | Your current booked interview date (YYYY-MM-DD) |
| `-l` | `--latest` | ❌ | Latest acceptable date - exits successfully once a date this early or earlier is booked |
| `-e` | `--earliest` | ❌ | Earliest acceptable date - skips dates before this |

### Examples

```bash
# Basic usage - reschedule to any earlier date
node index.js -c 2023-06-15

# With a latest acceptable date - stop once you get June 1st or earlier
node index.js -c 2023-06-15 -l 2023-06-01

# With an earliest acceptable date - only accept dates after May 1st
node index.js -c 2023-06-15 -e 2023-05-01

# With both constraints - only book between May 1st and June 1st
node index.js -c 2023-06-15 -l 2023-06-01 -e 2023-05-01

# Get help
node index.js --help
```

## How It Behaves

The bot will:
1. **Log in** to your account using provided credentials
2. **Check** for available dates every few seconds
3. **Compare** found dates against your constraints:
   - Must be earlier than current date (`-c`)
   - Must be on or after the earliest acceptable date (`-e`) if specified
   - Will exit successfully once the latest acceptable date (`-l`) is reached
4. **Book** the appointment automatically if conditions are met
5. **Continue** monitoring until the latest acceptable date is reached or manually stopped

## Output Examples

```
[2023-07-16T10:30:00.000Z] Initializing with current date 2023-08-15
[2023-07-16T10:30:00.000Z] Latest acceptable date: 2023-07-01
[2023-07-16T10:30:00.000Z] Earliest acceptable date: 2023-06-01
[2023-07-16T10:30:01.000Z] Logging in
[2023-07-16T10:30:03.000Z] nearest date is further than already booked (2023-08-15 vs 2023-09-01)
[2023-07-16T10:30:06.000Z] booked time at 2023-07-15 09:00
[2023-07-16T10:30:06.000Z] Latest acceptable date reached! Successfully booked appointment on 2023-07-15
```

## Safety Features

- ✅ **Read-only until booking** - Only books when better dates are found
- ✅ **Respects constraints** - Won't book outside your specified date range
- ✅ **Graceful exit** - Stops automatically once the latest acceptable date is reached
- ✅ **Error recovery** - Automatically retries on network errors
- ✅ **Secure credentials** - Uses environment variables for sensitive data

## Notifications

Two independent, optional notification channels - set either, both, or
neither. Both fire any time the bot finds and acts on a date it considers
better than your current one: in dry-run mode you get a "would have
booked" message, and with dry-run off (real bookings enabled) you get a
"rescheduled to &lt;date&gt; &lt;time&gt;" message right after the actual booking
succeeds.

### ntfy push notifications (recommended)

No AWS setup, no telecom registration of any kind. Set `NTFY_TOPIC` and
install the [ntfy app](https://ntfy.sh) subscribed to that same topic name:

```bash
NTFY_TOPIC=us-visa-bot-<pick-something-random> node index.js -c 2023-06-15 --dry-run
```

Pick a hard-to-guess topic name - public `https://ntfy.sh` topics are
unauthenticated, so anyone who knows the name can read your notifications
(or publish fake ones). Self-host ntfy and set `NTFY_SERVER` if you want
this fully private.

Test it independently first:

```bash
node index.js test-ntfy
# or override the .env values for a one-off test:
node index.js test-ntfy --topic us-visa-bot-mytopic --server https://ntfy.sh
```

### SMS via AWS SNS

Note: as of 2025, US carriers require A2P 10DLC brand/campaign
registration for SNS to reliably deliver SMS to US numbers - there's no
low-volume exemption for a single personal recipient. If you don't want to
go through that, `ntfy` above is the simpler path; SNS SMS is documented
here for completeness / non-US numbers / if you've already registered.

When you set `NOTIFY_PHONE_NUMBER` in your `.env` (or in the environment),
the bot texts that phone number via AWS SNS whenever it finds (dry run) or
actually books (real run) a better date:

```bash
NOTIFY_PHONE_NUMBER=+15551234567 node index.js -c 2023-06-15 --dry-run
```

This uses SNS's direct-to-phone-number publish, not a topic - no
subscription setup needed, just a verified/eligible destination number and
an AWS identity with `sns:Publish` permission.

Test it independently first:

```bash
node index.js test-sms
# or override the .env values for a one-off test:
node index.js test-sms --phone +15551234567 --region us-east-1
```

Both `test-sms` and `test-ntfy` send a single test message and exit - `0`
on success, `1` on failure with a log line explaining what went wrong. They
don't touch your visa credentials or config at all, so you can run either
before finishing the rest of the `.env` setup.

### "Still alive" heartbeat

Appointment notifications only fire when something changes, so there's no
built-in way to tell "no news" apart from "the bot silently died an hour
ago." Set `HEARTBEAT_INTERVAL` to get a periodic reminder that it's still
running, sent via whichever channel(s) you already configured above (ntfy
and/or SMS - no separate setup needed):

```bash
HEARTBEAT_INTERVAL=3h node index.js -c 2023-06-15 --dry-run
```

Accepts a bare number of hours, or a number with a unit suffix - `3h`,
`45m`, `90s`. Leave unset to disable. The first heartbeat fires one full
interval after the bot starts polling (not immediately on startup), and
then repeats on that interval for as long as the process keeps running.

### Running on EC2

The bot picks up AWS credentials automatically from the EC2 instance's IAM
role - no access keys need to live in `.env` or anywhere in this repo.

A t3.nano is plenty for this workload (it's a plain HTTP polling loop, no
browser automation) - roughly $3-4/month on-demand.

Note: new AWS accounts start in the SNS **SMS sandbox** in most regions,
which restricts sending to verified numbers only and caps monthly spend. If
texts aren't arriving, check whether your account needs to request
production access for SMS in the SNS console.

### Deploying with CloudFormation

`deploy/cloudformation.yaml` provisions everything needed to run this on
EC2: the instance (t3.nano by default), a security group, an IAM role
scoped to exactly what the bot needs (`sns:Publish` for SMS, plus
`secretsmanager:GetSecretValue` for a Secrets Manager secret it also
creates to hold your ais.usvisa-info.com login), and a systemd service. At
boot, the instance patches itself (`dnf update`), installs git and
Node.js, clones your repo, runs `npm install`, and starts the bot - no
manual deploy step required.

```bash
aws cloudformation deploy \
  --template-file deploy/cloudformation.yaml \
  --stack-name us-visa-bot \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
      VpcId=vpc-xxxxxxxx \
      SubnetId=subnet-xxxxxxxx \
      KeyPairName=my-key \
      SshAllowedCidr=203.0.113.4/32 \
      GitRepoUrl=https://github.com/you/us-visa-bot.git \
      GitBranch=main \
      UsVisaEmail=you@example.com \
      UsVisaPassword='your-password' \
      CountryCode=kz \
      ScheduleId=12345678 \
      FacilityId=44 \
      CurrentBookedDate=2026-09-01 \
      DryRun=true \
      NtfyTopic=us-visa-bot-<pick-something-random>
```

If the repo is private, you have two options. Simplest: embed a personal
access token in `GitRepoUrl` (`https://<token>@github.com/...`) - it's
`NoEcho` in the template, so it won't show up in `describe-stacks` output.

More scoped: use a dedicated, **read-only deploy key** (not your personal
SSH key) via `GitDeployKeyPrivate`:

```bash
ssh-keygen -t ed25519 -N "" -f deploy_key -C "us-visa-bot-deploy-key"
```

Add `deploy_key.pub` under the repo's **Settings → Deploy keys** (leave
"Allow write access" unchecked - the instance only ever needs to `git
clone`/`git pull`), then pass the private half as a parameter:

```bash
      GitRepoUrl=git@github.com:you/us-visa-bot.git \
      GitDeployKeyPrivate="$(cat deploy_key)" \
```

The template stores it in its own Secrets Manager secret (separate from
your visa credentials) and the instance fetches it into `ec2-user`'s
`~/.ssh` at boot - the same identity both the initial clone and any later
`git pull` (via `UpdateCodeCommand`) use, so you don't need to manage keys
in two places. Delete the local `deploy_key`/`deploy_key.pub` files once
they're uploaded; you won't need them again unless you're rotating the
key.

### Keeping parameters in a file instead of a long command line

`aws cloudformation deploy --parameter-overrides` only takes `KEY=VALUE`
pairs as separate command-line arguments - it doesn't read a YAML/JSON
file directly, which gets painful once you're passing something like a
multi-line private key. `deploy/deploy.py` bridges that: put your values
in a flat YAML file (e.g. `deploy/cloudformation_params.yml` - already
covered by `.gitignore` since it holds real credentials) and run:

```bash
pip install pyyaml --break-system-packages   # if you don't already have it
python3 deploy/deploy.py --params-file deploy/cloudformation_params.yml
```

Format a private key value with a YAML block scalar, not quotes, so the
line breaks are preserved exactly:

```yaml
GitDeployKeyPrivate: |
  -----BEGIN OPENSSH PRIVATE KEY-----
  b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
  QyNTUxOQAAACBTs0oPz0uNv8qN2VYb1z8mFZ...
  -----END OPENSSH PRIVATE KEY-----
```

Use `--dry-run` to print the command with values redacted, as a sanity
check on parameter names before you actually deploy.

Check progress and grab the instance's outputs once it's up:

```bash
aws cloudformation describe-stacks --stack-name us-visa-bot \
  --query "Stacks[0].Outputs"
```

If something looks wrong, `/var/log/cloud-init-output.log` on the
instance has the full boot/deploy log (reachable via SSH or the
`SsmSessionCommand` output).

Leave `KeyPairName`/`SshAllowedCidr` blank to launch with no SSH access at
all - the IAM role also grants Systems Manager Session Manager, so
`aws ssm start-session --target <instance-id>` still gets you a shell (see
the `SsmSessionCommand` output). To ship a newer commit later, use the
`UpdateCodeCommand` output (requires SSH to have been enabled).

`DryRun` defaults to `true` so a first deploy never books anything for
real - flip it to `false` (via a stack update, or `UpdateCodeCommand` plus
manually editing `.env` on the instance) once you've confirmed everything
is working as expected.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

This project is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE).

Commercial use is not permitted. You may use, modify, and distribute this
software for noncommercial purposes — personal use, research, education, and
use by nonprofit and government organizations. Selling it, offering it as a
paid service, or using it as part of a commercial offering requires a separate
license. Contact the copyright holder to discuss commercial terms.

## Disclaimer

This bot is for educational purposes. Use responsibly and in accordance with the terms of service of the visa appointment system. The authors are not responsible for any misuse or consequences.
