import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import type { AppConfig } from './config';
import { errorHandler, notFoundHandler } from './http/errorHandler';
import { adminRoutes } from './routes/adminRoutes';
import { bookingRoutes } from './routes/bookingRoutes';
import { runRoutes } from './routes/runRoutes';
import { sessionRoutes } from './routes/sessionRoutes';

export interface AppDeps {
  config: AppConfig;
  logger: Logger;
}

const REQUEST_ID = /^[\w-]{1,64}$/;

/**
 * Builds the Express app WITHOUT listening, so tests (Supertest) can use it
 * directly; src/server.ts calls listen.
 */
export function createApp({ config, logger }: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');

  // Structured request logs; every request gets an id (echoed back as x-request-id),
  // and req.log is a child logger carrying it.
  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id =
          typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
    }),
  );
  app.use(express.json({ limit: '10kb' }));
  app.use(cookieParser(config.sessionSecret));

  app.use('/api/session', sessionRoutes(config));
  app.use('/api/run', runRoutes());
  app.use('/api/bookings', bookingRoutes(config));
  app.use('/api/admin', adminRoutes(config));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
