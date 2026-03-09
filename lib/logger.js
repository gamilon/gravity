const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const level = LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LEVELS.info;

function format(severity, ...args) {
  const ts = new Date().toISOString();
  return [`[${ts}]`, severity.toUpperCase(), ...args].map(String).join(' ');
}

function log(severity, ...args) {
  if (LEVELS[severity] > level) return;
  const msg = format(severity, ...args);
  if (severity === 'error') console.error(msg);
  else console.log(msg);
}

module.exports = {
  info: (...args) => log('info', ...args),
  warn: (...args) => log('warn', ...args),
  error: (...args) => log('error', ...args),
  debug: (...args) => log('debug', ...args),
};
