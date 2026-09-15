const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let logFile = null;

function logPath() {
  if (!logFile) {
    logFile = path.join(app.getPath('userData'), 'rbvpn-connect.log');
  }
  return logFile;
}

function log(level, message, detail) {
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${message}${
    detail != null ? ` | ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''
  }`;
  try {
    fs.appendFileSync(logPath(), `${line}\n`, 'utf8');
  } catch {
    // ignore disk errors
  }
  if (level === 'error') console.error(line);
  else console.log(line);
  return line;
}

function clearLog() {
  try {
    fs.writeFileSync(logPath(), '', 'utf8');
  } catch {
    // ignore
  }
}

function readLogTail(maxBytes = 32_000) {
  const p = logPath();
  if (!fs.existsSync(p)) return '';
  const buf = fs.readFileSync(p);
  if (buf.length <= maxBytes) return buf.toString('utf8');
  return buf.subarray(buf.length - maxBytes).toString('utf8');
}

module.exports = { log, logPath, clearLog, readLogTail };
