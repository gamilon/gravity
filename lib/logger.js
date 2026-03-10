const fs = require('fs');
const path = require('path');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const level = LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LEVELS.info;

const defaultDir = path.join(__dirname, '..', 'logs');
const logDir = process.env.LOG_DIR || defaultDir;
const logFile = process.env.LOG_FILE || path.join(logDir, 'gravity.log');

let stream = null;
try {
  fs.mkdirSync(logDir, { recursive: true });
  stream = fs.createWriteStream(logFile, { flags: 'a' });
} catch {
  // If file logging fails, we still log to stdout/stderr.
}

function format(severity, ...args) {
  const ts = new Date().toISOString();
  return [`[${ts}]`, severity.toUpperCase(), ...args].map(String).join(' ');
}

function log(severity, ...args) {
  if (LEVELS[severity] > level) return;
  const msg = format(severity, ...args);

  // Console (for systemd/journald or dev)
  if (severity === 'error') console.error(msg);
  else console.log(msg);

  // Append to log file
  if (stream) {
    stream.write(msg + '\n');
  }
}

module.exports = {
  info: (...args) => log('info', ...args),
  warn: (...args) => log('warn', ...args),
  error: (...args) => log('error', ...args),
  debug: (...args) => log('debug', ...args),
};
