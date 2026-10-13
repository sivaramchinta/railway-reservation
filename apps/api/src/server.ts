import './loadEnv'; // must stay the first import: db.ts reads DATABASE_URL on import
import { createApp } from './app';
import { loadConfig } from './config';
import { prisma } from './db';
import { createLogger } from './logger';

const config = loadConfig();
const logger = createLogger(config.logLevel);
const app = createApp({ config, logger });

const server = app.listen(config.port, () => {
  logger.info({ port: config.port }, 'API listening');
});

function shutdown(signal: string): void {
  logger.info({ signal }, 'Shutting down');
  server.close(() => {
    void prisma.$disconnect().then(() => process.exit(0));
  });
}
process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  shutdown('SIGINT');
});
