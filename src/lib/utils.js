export function sleep(seconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, seconds * 1000);
  });
}

export function log(message) {
  console.log(`[${new Date().toISOString()}]`, message);
}

export function isSocketHangupError(err) {
  return err.code === 'ECONNRESET' ||
         err.code === 'ENOTFOUND' ||
         err.code === 'ETIMEDOUT' ||
         err.message.includes('socket hang up') ||
         err.message.includes('network') ||
         err.message.includes('connection');
}

// Parses a duration string like "3h", "45m", "90s", or a bare number (which
// defaults to hours, since that's the natural unit for something like a
// "still alive" heartbeat interval) into a number of seconds. Returns null
// for an empty/unset value, and throws on anything else unparseable so the
// caller can surface a clear config error instead of silently misbehaving.
export function parseDurationToSeconds(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const match = String(value).trim().match(/^(\d+(?:\.\d+)?)\s*([hms])?$/i);
  if (!match) {
    throw new Error(`invalid duration "${value}" - expected e.g. "3h", "45m", "90s", or a bare number of hours`);
  }

  const amount = Number(match[1]);
  const unit = (match[2] || 'h').toLowerCase();
  const multiplier = { h: 3600, m: 60, s: 1 }[unit];

  return amount * multiplier;
}