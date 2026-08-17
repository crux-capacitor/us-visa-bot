import dotenv from 'dotenv';
import { parseDurationToSeconds } from './utils.js';

dotenv.config();

export function getConfig() {
  const config = {
    email: process.env.EMAIL,
    password: process.env.PASSWORD,
    scheduleId: process.env.SCHEDULE_ID,
    facilityId: process.env.FACILITY_ID,
    countryCode: process.env.COUNTRY_CODE,
    refreshDelay: Number(process.env.REFRESH_DELAY || 3),
    // Optional: only used to gate notifications in dry-run mode. Not
    // required, so these are deliberately left out of validateConfig() below.
    notifyPhoneNumber: process.env.NOTIFY_PHONE_NUMBER || null,
    awsRegion: process.env.AWS_REGION || null,
    // ntfy push notifications - no AWS/telecom registration needed. See
    // .env.example for setup. NTFY_SERVER defaults to the public ntfy.sh.
    ntfyTopic: process.env.NTFY_TOPIC || null,
    ntfyServer: process.env.NTFY_SERVER || 'https://ntfy.sh',
    // Optional "still alive" heartbeat - see .env.example. Sent via
    // whichever notification channel(s) above are configured.
    heartbeatIntervalSeconds: parseHeartbeatInterval(process.env.HEARTBEAT_INTERVAL)
  };

  validateConfig(config);
  return config;
}

function parseHeartbeatInterval(value) {
  try {
    return parseDurationToSeconds(value);
  } catch (err) {
    console.error(`Invalid HEARTBEAT_INTERVAL: ${err.message}. Heartbeat notifications disabled.`);
    return null;
  }
}

function validateConfig(config) {
  const required = ['email', 'password', 'scheduleId', 'facilityId', 'countryCode'];
  const missing = required.filter(key => !config[key]);

  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.map(k => k.toUpperCase()).join(', ')}`);
    process.exit(1);
  }
}

export function getBaseUri(countryCode) {
  return `https://ais.usvisa-info.com/en-${countryCode}/niv`;
}
