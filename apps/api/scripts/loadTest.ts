// Load test: N users book ONE Sleeper seat each, all at the same instant, over HTTP.
// Measures booking latency and checks the outcome (exactly 40 confirmed).
//
//   npx tsx apps/api/scripts/loadTest.ts [baseUrl] [users]
//   e.g. npx tsx apps/api/scripts/loadTest.ts http://localhost:4000 500
//
// Needs a fresh, seeded database (NOT_YET_OPEN) and ADMIN_EMAILS containing
// admin@example.com. It opens the booking window itself.
import { randomUUID } from 'node:crypto';
import { RunSummaryDtoSchema } from '@railway/shared';

const baseUrl = process.argv[2] ?? 'http://localhost:4000';
const users = Number(process.argv[3] ?? '500');
const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

async function signIn(email: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const cookie = res.headers.get('set-cookie')?.split(';')[0];
  if (!res.ok || cookie === undefined)
    throw new Error(`sign-in failed for ${email}: ${res.status}`);
  return cookie;
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? NaN;
}

async function main(): Promise<void> {
  const admin = await signIn('admin@example.com');
  const opened = await fetch(`${baseUrl}/api/admin/window/open`, {
    method: 'POST',
    headers: { cookie: admin },
  });
  if (!opened.ok) throw new Error(`could not open the window: ${opened.status}`);

  out(`Signing in ${users} users…`);
  const cookies = await Promise.all(
    Array.from({ length: users }, (_, i) => signIn(`load${i}-${randomUUID()}@test.local`)),
  );

  out(`Firing ${users} concurrent bookings (SL, 1 passenger each)…`);
  const start = performance.now();
  const results = await Promise.all(
    cookies.map(async (cookie) => {
      const t0 = performance.now();
      const res = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'Idempotency-Key': randomUUID(), cookie },
        body: JSON.stringify({ classCode: 'SL', passengers: [{ name: 'Load' }] }),
      });
      await res.arrayBuffer();
      return { status: res.status, ms: performance.now() - t0 };
    }),
  );
  const totalMs = performance.now() - start;

  const latencies = results.map((r) => r.ms).sort((a, b) => a - b);
  const byStatus = new Map<number, number>();
  for (const r of results) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);

  const run = RunSummaryDtoSchema.parse(await (await fetch(`${baseUrl}/api/run`)).json());
  const sl = run.classes.find((c) => c.code === 'SL');

  out('');
  out(
    `Requests:     ${users} (statuses: ${[...byStatus].map(([s, n]) => `${s}×${n}`).join(', ')})`,
  );
  out(
    `Wall time:    ${(totalMs / 1000).toFixed(2)} s  →  ${(users / (totalMs / 1000)).toFixed(0)} bookings/s`,
  );
  out(
    `Latency (ms): p50 ${percentile(latencies, 50).toFixed(0)} · p90 ${percentile(latencies, 90).toFixed(0)} · p99 ${percentile(latencies, 99).toFixed(0)} · max ${percentile(latencies, 100).toFixed(0)}`,
  );
  out(
    `Outcome:      SL confirmed ${sl?.confirmed ?? '?'} / ${sl?.capacity ?? '?'}, waitlisted ${sl?.waitlistLength ?? '?'}`,
  );
  const ok =
    byStatus.get(201) === users && sl?.confirmed === 40 && sl.waitlistLength === users - 40;
  out(ok ? 'PASS: every request succeeded; exactly 40 confirmed.' : 'FAIL: see numbers above.');
  process.exitCode = ok ? 0 : 1;
}

void main();
