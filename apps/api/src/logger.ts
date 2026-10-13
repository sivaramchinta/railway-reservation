import pino, { type Logger } from 'pino';

/** Structured JSON logs (no console.log anywhere). Cookies never reach the logs. */
export function createLogger(level: string): Logger {
  return pino({
    level,
    redact: ['req.headers.cookie', 'res.headers["set-cookie"]'],
  });
}
