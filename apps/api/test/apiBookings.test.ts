// HTTP: /api/bookings* and /api/admin/* end to end (Supertest, real Postgres).
// Every response is parsed with the shared Zod schema, so these are contract tests.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import {
  BookingDtoSchema,
  ChartDtoSchema,
  ChartSummaryDtoSchema,
  ErrorBodySchema,
  RunSummaryDtoSchema,
} from '@railway/shared';
import request from 'supertest';
import { z } from 'zod';
import { prisma } from '../src/db';
import { classOutcome, oneTo, resetDb } from './helpers/db';
import { ADMIN_EMAIL, type Agent, signedIn, testApp } from './helpers/http';
import { expectInvariantsHold } from './invariants';

const app = testApp();
let admin: Agent;
let alice: Agent;
let bob: Agent;

beforeEach(async () => {
  await resetDb();
  admin = await signedIn(app, ADMIN_EMAIL);
  alice = await signedIn(app, 'alice@test.local');
  bob = await signedIn(app, 'bob@test.local');
  await admin.post('/api/admin/window/open').expect(200);
});

afterEach(async () => {
  await expectInvariantsHold();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const errorCode = (body: unknown): string => ErrorBodySchema.parse(body).error.code;

function postBooking(agent: Agent, classCode: string, names: string[], key: string = randomUUID()) {
  return agent
    .post('/api/bookings')
    .set('Idempotency-Key', key)
    .send({ classCode, passengers: names.map((name) => ({ name })) });
}

async function fill(agent: Agent, classCode: string, count: number): Promise<void> {
  for (let left = count; left > 0; left -= 6) {
    const n = Math.min(6, left);
    await postBooking(
      agent,
      classCode,
      Array.from({ length: n }, (_, i) => `F${i}`),
    ).expect(201);
  }
}

describe('authentication and authorisation', () => {
  it.each([
    ['get', '/api/bookings'],
    ['post', '/api/bookings'],
    ['get', '/api/bookings/ABCDEFGHJK'],
    ['post', '/api/bookings/ABCDEFGHJK/cancel'],
    ['post', '/api/admin/window/open'],
    ['get', '/api/admin/chart'],
  ] as const)('%s %s without a session → 401', async (method, path) => {
    const res = await request(app)[method](path);
    expect(res.status).toBe(401);
    expect(errorCode(res.body)).toBe('UNAUTHENTICATED');
  });

  it.each([
    ['post', '/api/admin/window/open'],
    ['post', '/api/admin/window/close'],
    ['post', '/api/admin/chart/prepare'],
    ['get', '/api/admin/chart'],
  ] as const)('%s %s as a non-admin → 403', async (method, path) => {
    const res = await alice[method](path);
    expect(res.status).toBe(403);
    expect(errorCode(res.body)).toBe('FORBIDDEN');
  });
});

describe('POST /api/bookings', () => {
  it('201 with a BookingDto', async () => {
    const res = await postBooking(alice, 'SL', ['Asha', 'Ravi']).expect(201);
    const booking = BookingDtoSchema.parse(res.body);
    expect(booking.status).toBe('CONFIRMED');
    expect(booking.passengers.map((p) => p.name)).toEqual(['Asha', 'Ravi']);
    expect(res.body).not.toHaveProperty('id'); // internal id is never exposed
  });

  it('idempotent replay → 200 with the same PNR, one booking', async () => {
    const key = randomUUID();
    const first = await postBooking(alice, 'SL', ['A'], key).expect(201);
    const replay = await postBooking(alice, 'SL', ['A'], key).expect(200);
    expect(BookingDtoSchema.parse(replay.body).pnr).toBe(BookingDtoSchema.parse(first.body).pnr);
    expect(await prisma.booking.count()).toBe(1);
  });

  it('group split: 3 CNF + 1 WL with waitlistNumber and currentWaitlistPosition', async () => {
    await fill(alice, 'AC', 17);
    const res = await postBooking(alice, 'AC', ['A', 'B', 'C', 'D']).expect(201);
    const booking = BookingDtoSchema.parse(res.body);
    expect(booking.status).toBe('PARTIALLY_CONFIRMED');
    expect(booking.passengers[3]).toEqual({
      position: 4,
      name: 'D',
      status: 'WAITLISTED',
      waitlistNumber: 1,
      currentWaitlistPosition: 1,
    });
  });

  it.each<[string, unknown, string | undefined]>([
    ['no passengers', { classCode: 'SL', passengers: [] }, randomUUID()],
    ['7 passengers', { classCode: 'SL', passengers: Array(7).fill({ name: 'A' }) }, randomUUID()],
    ['blank name', { classCode: 'SL', passengers: [{ name: '  ' }] }, randomUUID()],
    ['unknown class', { classCode: 'ZZ', passengers: [{ name: 'A' }] }, randomUUID()],
    ['missing Idempotency-Key', { classCode: 'SL', passengers: [{ name: 'A' }] }, undefined],
    ['bad Idempotency-Key', { classCode: 'SL', passengers: [{ name: 'A' }] }, 'abc'],
  ])('%s → 422 VALIDATION_FAILED', async (_label, body, key) => {
    const req = alice.post('/api/bookings');
    if (key !== undefined) void req.set('Idempotency-Key', key);
    const res = await req.send(body as object);
    expect(res.status).toBe(422);
    expect(errorCode(res.body)).toBe('VALIDATION_FAILED');
  });

  it('reports field-level details for invalid bodies', async () => {
    const res = await alice
      .post('/api/bookings')
      .set('Idempotency-Key', randomUUID())
      .send({ classCode: '', passengers: [{ name: '' }] });
    const details = z
      .object({ fieldErrors: z.record(z.string(), z.array(z.string())) })
      .parse(ErrorBodySchema.parse(res.body).error.details);
    expect(Object.keys(details.fieldErrors)).toContain('body');
  });

  it('after close → 409 BOOKING_CLOSED', async () => {
    await admin.post('/api/admin/window/close').expect(200);
    const res = await postBooking(alice, 'SL', ['A']);
    expect(res.status).toBe(409);
    expect(errorCode(res.body)).toBe('BOOKING_CLOSED');
  });
});

describe('GET /api/bookings and /api/bookings/:pnr', () => {
  it('lists only my bookings, newest first', async () => {
    const first = BookingDtoSchema.parse(
      (await postBooking(alice, 'SL', ['First']).expect(201)).body,
    );
    const second = BookingDtoSchema.parse(
      (await postBooking(alice, 'AC', ['Second']).expect(201)).body,
    );
    await postBooking(bob, 'SL', ['Bob']).expect(201);

    const res = await alice.get('/api/bookings').expect(200);
    const list = z.array(BookingDtoSchema).parse(res.body);
    expect(list.map((b) => b.pnr)).toEqual([second.pnr, first.pnr]);
  });

  it("edge case 13: another user's PNR → 404 for read and cancel", async () => {
    const bobs = BookingDtoSchema.parse((await postBooking(bob, 'SL', ['Bob']).expect(201)).body);
    expect((await alice.get(`/api/bookings/${bobs.pnr}`)).status).toBe(404);
    const cancel = await alice.post(`/api/bookings/${bobs.pnr}/cancel`);
    expect(cancel.status).toBe(404);
    expect(errorCode(cancel.body)).toBe('NOT_FOUND');
  });

  it('shows "WL n (now WL m)" as people ahead cancel', async () => {
    await fill(alice, 'AC', 20);
    const wl1 = BookingDtoSchema.parse((await postBooking(alice, 'AC', ['W1']).expect(201)).body);
    const wl2 = BookingDtoSchema.parse((await postBooking(bob, 'AC', ['W2']).expect(201)).body);
    await alice.post(`/api/bookings/${wl1.pnr}/cancel`).expect(200);

    const res = await bob.get(`/api/bookings/${wl2.pnr}`).expect(200);
    expect(BookingDtoSchema.parse(res.body).passengers[0]).toMatchObject({
      waitlistNumber: 2,
      currentWaitlistPosition: 1,
    });
  });
});

describe('POST /api/bookings/:pnr/cancel', () => {
  it('cancels (200) and is idempotent', async () => {
    const booking = BookingDtoSchema.parse(
      (await postBooking(alice, 'SL', ['A']).expect(201)).body,
    );
    const first = await alice.post(`/api/bookings/${booking.pnr}/cancel`).expect(200);
    const again = await alice.post(`/api/bookings/${booking.pnr}/cancel`).expect(200);
    expect(BookingDtoSchema.parse(first.body).status).toBe('CANCELLED');
    expect(again.body).toEqual(first.body);
  });
});

describe('admin: window and chart', () => {
  it('open twice → 200 both times; open after close → 409 INVALID_WINDOW_TRANSITION', async () => {
    const again = await admin.post('/api/admin/window/open').expect(200);
    expect(RunSummaryDtoSchema.parse(again.body).chartStatus).toBe('OPEN');
    await admin.post('/api/admin/window/close').expect(200);
    const reopen = await admin.post('/api/admin/window/open');
    expect(reopen.status).toBe(409);
    expect(errorCode(reopen.body)).toBe('INVALID_WINDOW_TRANSITION');
  });

  it('prepare while open → 409 WINDOW_STILL_OPEN', async () => {
    const res = await admin.post('/api/admin/chart/prepare');
    expect(res.status).toBe(409);
    expect(errorCode(res.body)).toBe('WINDOW_STILL_OPEN');
  });

  it('full flow: book → close → prepare → seat labels in My bookings and the seat map; then CHART_LOCKED', async () => {
    const booking = BookingDtoSchema.parse(
      (await postBooking(alice, 'AC', ['Asha', 'Ravi']).expect(201)).body,
    );
    await admin.post('/api/admin/window/close').expect(200);

    const summary = ChartSummaryDtoSchema.parse(
      (await admin.post('/api/admin/chart/prepare').expect(200)).body,
    );
    expect(summary.classes.find((c) => c.classCode === 'AC')).toMatchObject({ seatsUsed: 2 });

    const mine = BookingDtoSchema.parse((await alice.get(`/api/bookings/${booking.pnr}`)).body);
    expect(mine.passengers.map((p) => p.seatLabel)).toEqual(['A1-01', 'A1-02']);

    const chart = ChartDtoSchema.parse((await admin.get('/api/admin/chart').expect(200)).body);
    const a1 = chart.coaches.find((c) => c.label === 'A1');
    expect(a1?.seats[0]).toEqual({
      number: 1,
      label: 'A1-01',
      pnr: booking.pnr,
      passengerName: 'Asha',
    });

    const run = RunSummaryDtoSchema.parse((await request(app).get('/api/run')).body);
    expect(run.chartStatus).toBe('CHART_LOCKED');
    expect(run.chartPreparedAt).not.toBeNull();

    const cancel = await alice.post(`/api/bookings/${booking.pnr}/cancel`);
    expect(cancel.status).toBe(409);
    expect(errorCode(cancel.body)).toBe('CHART_LOCKED');
  });
});

describe('concurrency over HTTP', () => {
  it('30 parallel bookings from 30 users on AC (capacity 20) → 20 CONFIRMED, WL 1..10', async () => {
    const agents = await Promise.all(
      Array.from({ length: 30 }, (_, i) => signedIn(app, `parallel${i}@test.local`)),
    );

    const responses = await Promise.all(agents.map((agent) => postBooking(agent, 'AC', ['P'])));

    expect(responses.every((r) => r.status === 201)).toBe(true);
    const ac = await classOutcome('AC');
    expect(ac.confirmed).toBe(20);
    expect(ac.waitlistNumbers).toEqual(oneTo(10));
  });

  it('the same Idempotency-Key ×5 in parallel → one 201, four 200, one PNR', async () => {
    const key = randomUUID();
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => postBooking(alice, 'SL', ['A'], key)),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(new Set(responses.map((r) => BookingDtoSchema.parse(r.body).pnr)).size).toBe(1);
  });
});
