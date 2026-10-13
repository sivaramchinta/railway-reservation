// HTTP: sessions, GET /api/run, and the error contract (Supertest, real Postgres).
import { describe, expect, it, afterAll, beforeEach } from '@jest/globals';
import { ErrorBodySchema, RunSummaryDtoSchema, SessionDtoSchema } from '@railway/shared';
import express from 'express';
import pino from 'pino';
import { pinoHttp } from 'pino-http';
import request from 'supertest';
import { prisma } from '../src/db';
import { AppError, InvariantViolationError } from '../src/domain/errors';
import { errorHandler } from '../src/http/errorHandler';
import { resetDb } from './helpers/db';
import { ADMIN_EMAIL, signedIn, testApp } from './helpers/http';

const app = testApp();

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

function errorCode(body: unknown): string {
  return ErrorBodySchema.parse(body).error.code;
}

describe('POST /api/session', () => {
  it('signs in by email (trimmed, lower-cased) and sets a signed, HTTP-only cookie', async () => {
    const res = await request(app).post('/api/session').send({ email: '  Asha@Example.COM ' });

    expect(res.status).toBe(200);
    expect(SessionDtoSchema.parse(res.body)).toEqual({ email: 'asha@example.com', isAdmin: false });
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/^session=s%3A/); // "s:" prefix = signed value
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
  });

  it('marks emails in ADMIN_EMAILS as admin', async () => {
    const res = await request(app).post('/api/session').send({ email: ADMIN_EMAIL });
    expect(SessionDtoSchema.parse(res.body).isAdmin).toBe(true);
  });

  it('reuses the same user on a second sign-in', async () => {
    await request(app).post('/api/session').send({ email: 'same@test.local' });
    await request(app).post('/api/session').send({ email: 'SAME@test.local' });
    expect(await prisma.appUser.count()).toBe(1);
  });

  it.each([{ email: 'not-an-email' }, {}, { email: '' }])('rejects %o with 422', async (body) => {
    const res = await request(app).post('/api/session').send(body);
    expect(res.status).toBe(422);
    expect(errorCode(res.body)).toBe('VALIDATION_FAILED');
  });
});

describe('GET / DELETE /api/session', () => {
  it('returns the signed-in user, then 401 after sign-out', async () => {
    const agent = await signedIn(app, 'me@test.local');
    const me = await agent.get('/api/session').expect(200);
    expect(SessionDtoSchema.parse(me.body).email).toBe('me@test.local');

    await agent.delete('/api/session').expect(204);
    const after = await agent.get('/api/session');
    expect(after.status).toBe(401);
    expect(errorCode(after.body)).toBe('UNAUTHENTICATED');
  });

  it('401 without a cookie', async () => {
    const res = await request(app).get('/api/session');
    expect(res.status).toBe(401);
  });

  it('401 for a tampered cookie (the signature no longer matches)', async () => {
    const res = await request(app).post('/api/session').send({ email: 'victim@test.local' });
    const forged = String(res.headers['set-cookie']).replace(/^session=s%3A\d+/, 'session=s%3A999');
    const probe = await request(app)
      .get('/api/session')
      .set('Cookie', forged.split(';')[0] ?? '');
    expect(probe.status).toBe(401);
  });

  it('401 for an unsigned cookie with a raw user id', async () => {
    await request(app).post('/api/session').send({ email: 'victim@test.local' });
    const probe = await request(app).get('/api/session').set('Cookie', 'session=1');
    expect(probe.status).toBe(401);
  });
});

describe('GET /api/run', () => {
  it('is public and matches the shared RunSummaryDto schema', async () => {
    const res = await request(app).get('/api/run').expect(200);
    const run = RunSummaryDtoSchema.parse(res.body);
    expect(run).toMatchObject({ trainNumber: '12345', chartStatus: 'NOT_YET_OPEN' });
    expect(run.classes.map((c) => c.code)).toEqual(['AC', 'SL']);
  });
});

describe('error contract', () => {
  it('unknown endpoint → 404 in the standard error shape', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(errorCode(res.body)).toBe('NOT_FOUND');
  });

  it('malformed JSON → 422 VALIDATION_FAILED', async () => {
    const res = await request(app)
      .post('/api/session')
      .set('Content-Type', 'application/json')
      .send('{"email":');
    expect(res.status).toBe(422);
    expect(errorCode(res.body)).toBe('VALIDATION_FAILED');
  });

  it('echoes a request id on every response', async () => {
    const res = await request(app).get('/api/run').set('x-request-id', 'trace-123');
    expect(res.headers['x-request-id']).toBe('trace-123');
    const generated = await request(app).get('/api/run');
    expect(String(generated.headers['x-request-id'])).toMatch(/^[0-9a-f-]{36}$/);
  });

  describe('errorHandler', () => {
    const mini = express();
    mini.use(pinoHttp({ logger: pino({ level: 'silent' }) }));
    mini.get('/bug', () => {
      throw new InvariantViolationError('secret internal detail');
    });
    mini.get('/async-bug', async () => {
      await Promise.resolve();
      throw new Error('async failure');
    });
    mini.get('/app-error', () => {
      throw new AppError('VALIDATION_FAILED', 'bad', { field: 'x' });
    });
    mini.use(errorHandler);

    it('turns a bug into 500 INTERNAL_ERROR without leaking the message', async () => {
      const res = await request(mini).get('/bug');
      expect(res.status).toBe(500);
      expect(ErrorBodySchema.parse(res.body).error).toEqual({
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong',
      });
    });

    it('catches errors thrown in async handlers (Express 5, no wrapper)', async () => {
      const res = await request(mini).get('/async-bug');
      expect(res.status).toBe(500);
    });

    it('passes AppError details through', async () => {
      const res = await request(mini).get('/app-error');
      expect(res.status).toBe(422);
      expect(ErrorBodySchema.parse(res.body).error.details).toEqual({ field: 'x' });
    });
  });
});
