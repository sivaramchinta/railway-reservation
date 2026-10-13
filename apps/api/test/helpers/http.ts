// Supertest helpers: build the real app (no listen) with a test config.
import type { Express } from 'express';
import pino from 'pino';
import request from 'supertest';
import { createApp } from '../../src/app';
import type { AppConfig } from '../../src/config';

export const ADMIN_EMAIL = 'admin@test.local';

export const testConfig: AppConfig = {
  sessionSecret: 'test-session-secret-at-least-32-chars',
  adminEmails: new Set([ADMIN_EMAIL]),
  secureCookies: false,
  port: 0,
  logLevel: 'silent',
};

export function testApp(): Express {
  return createApp({ config: testConfig, logger: pino({ level: 'silent' }) });
}

export type Agent = ReturnType<typeof request.agent>;

/** An agent (keeps cookies like a browser) already signed in as `email`. */
export async function signedIn(app: Express, email: string): Promise<Agent> {
  const agent = request.agent(app);
  await agent.post('/api/session').send({ email }).expect(200);
  return agent;
}
