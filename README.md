# Mini Railway Reservation System

IRCTC-style booking for **one train, one journey date, two classes** (Sleeper 40
seats, AC 20). Each booking gets a PNR, and each passenger is CONFIRMED or
WAITLISTED. After the booking window closes, **chart preparation** promotes the
waitlist into freed seats, assigns physical seats (`S1-07`) and locks the chart.

**The core claim: no seat is ever allocated twice, under any amount of
concurrent load.** PostgreSQL is the single authority on seats. Every booking and
cancellation is one short transaction serialized on a per-class row lock, and
seats are assigned exactly once, in one atomic, self-verifying
chart-preparation transaction. The claim is backed by concurrency tests against
real PostgreSQL, an SQL invariant checker after every test, and a demonstration
that the tests **fail** when the lock is removed.

---

## Run it

**One command** (Docker Desktop running):

```bash
docker compose up --build
```

Then open **http://localhost:3000**. Sign in as `admin@example.com` (admin), and
as any other email in a second browser profile to book. The first build takes
about 2 minutes. The API is also on http://localhost:4000. To start from an
empty database: `docker compose down -v`.

Verified on 2026-10-13 from a fresh copy of the repository (no `.env`, no
`node_modules`): the stack came up, migrated and seeded itself, and the manual QA
checklist below passed in a real browser (17/17 checks).

### Local development

```bash
cp .env.example .env                       # once
docker compose up -d db                    # only PostgreSQL
npm install
npm run db:migrate && npm run db:seed
npm run dev                                # API :4000 + web http://localhost:3000
```

| Command                                                          | What it does                                                         |
| ---------------------------------------------------------------- | -------------------------------------------------------------------- |
| `npm run lint` / `npm run typecheck`                             | ESLint (type-aware, no `any`, no `console`) / `tsc` in every package |
| `npm test`                                                       | All 299 tests (starts a throwaway PostgreSQL via testcontainers)     |
| `npm run test:coverage`                                          | Same, plus the 100% coverage gate on the pure domain layer           |
| `npm run db:reset`                                               | Wipe the dev database, migrate, reseed                               |
| `npm run load-test -w @railway/api -- http://localhost:4000 500` | 500 concurrent bookings (needs a fresh DB)                           |

---

## Architecture

```
 Browser ──► Next.js (App Router, :3000) ──rewrite /api/*──► Express 5 API (:4000) ──► PostgreSQL 16
             React + TanStack Query                          routes → services → repositories
             (polls status every 5 s)                                   └─► domain (pure functions)
                         └──────── packages/shared: Zod schemas = the API contract ────────┘
```

A **modular monolith in TypeScript**: one stateless API, one database, one
frontend. Every correctness guarantee comes from the database, so distributing
the parts would only add ways to break them.

| Layer        | Folder                      | Rule                                                                                                     |
| ------------ | --------------------------- | -------------------------------------------------------------------------------------------------------- |
| Routes       | `apps/api/src/routes`       | Parse body + params + query with Zod, call a service, map to JSON. No business logic.                    |
| Services     | `apps/api/src/services`     | Own the transaction (`runInTransaction`), orchestrate domain + repositories.                             |
| Repositories | `apps/api/src/repositories` | All database access. Raw SQL only here, only as tagged templates (bind parameters).                      |
| Domain       | `apps/api/src/domain`       | Pure functions: state machines, fairness rule, seat matching, PNR, derived status. 100% branch coverage. |
| Shared       | `packages/shared`           | Zod schemas for every request and response, used by API, tests and web.                                  |

**Stack:** TypeScript (strict, no `any`) · Node 24 · Express 5 · Zod 4 · Prisma 7
(pg driver adapter) · PostgreSQL 16 · Next.js 16 + Tailwind v4 + TanStack Query
· Jest + Supertest + testcontainers · ESLint + Prettier · pino.

---

## The four invariants

Everything in the design protects these:

| #   | Invariant                                                                                  | Enforced by                                                                         |
| --- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| 1   | **Capacity:** CONFIRMED passengers per class ≤ capacity                                    | Per-class row lock during booking; verification inside chart preparation            |
| 2   | **Seat uniqueness:** a seat is allocated to at most one passenger                          | Seats assigned only in one atomic transaction; `UNIQUE(train_run_id, seat_id)`      |
| 3   | **Fair ordering:** the waitlist moves strictly by number; no new booking jumps ahead of it | The fairness rule (below), evaluated under the lock; promotion by `waitlist_number` |
| 4   | **Chart finality:** once CHART_LOCKED, nothing changes                                     | Status checked under the lock by every write; chart prep holds every class lock     |

---

## Data model

Ten tables in third normal form (`prisma/schema.prisma`, SQL in `prisma/migrations/`):

| Table                             | Key columns                                                           | Constraints that protect invariants                                        |
| --------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `train` / `train_run`             | run: window times, `chart_status`, `chart_prepared_at`                | `UNIQUE(train_id, journey_date)`; **CHECK** opens < closes                 |
| `travel_class` / `coach` / `seat` | coach: class, label, ordinal; seat: number                            | `UNIQUE(coach_id, seat_number)`; **CHECK** seat_number > 0                 |
| `class_inventory`                 | `(train_run_id, class_code)`, `capacity`, `next_waitlist_number`      | **The row booking locks**; **CHECK** capacity > 0, next WL ≥ 1             |
| `app_user`                        | `email` (lower-cased)                                                 | `UNIQUE(email)`                                                            |
| `booking`                         | internal `id` (bigint), public `pnr`, `idempotency_key`, `created_at` | `UNIQUE(pnr)`; `UNIQUE(user_id, idempotency_key)`; FK to `class_inventory` |
| `passenger`                       | `position`, `name`, `status`, `waitlist_number`                       | **CHECK** WAITLISTED ⇒ has a number; **CHECK** position 1–6                |
| `seat_allocation`                 | `passenger_id` (PK), `train_run_id`, `seat_id`                        | **`UNIQUE(train_run_id, seat_id)`**: the last line of defence              |

- **Status lives on the passenger.** A PNR of 4 can be 3 CONFIRMED + 1
  WAITLISTED. The booking status (Confirmed / Partially confirmed / Waitlisted /
  Cancelled / Not confirmed) is **derived** from the passengers, never stored.
- **The confirmed count is computed** under the lock, never stored.
- **`next_waitlist_number` is an allocator:** each waitlisted passenger keeps a
  permanent number ("WL 7"); the current position ("now WL 3") is computed on read.
- **The PNR is separate from the internal id**, so nothing about volume or order
  leaks, and joins stay on compact integers.
- **CHECK constraints** can't be written in Prisma's schema language, so they're
  hand-added to the migration SQL. A test proves each exists (and failed when one
  was dropped).

---

## Concurrency design

**One rule:** every booking and cancellation takes **exactly one lock**, its
class's `class_inventory` row (`SELECT … FOR UPDATE`, raw SQL inside a Prisma
interactive transaction at READ COMMITTED). Chart preparation takes the
`train_run` lock, then **all** class locks in `class_code` order.

**Why this is correct:**

- **No overbooking.** Two bookings in one class can't interleave between "count
  confirmed" and "insert". The second waits at the lock, then counts again after
  the first commits.
- **Chart prep and writes never overlap,** because chart prep holds every class
  lock. A write arriving afterwards reads CHART_LOCKED and is refused cleanly.
- **No deadlocks.** Every transaction takes locks in the same order. Booking and
  cancellation only _read_ the run row, so they never wait for it while holding
  a class lock.
- **Different classes don't block each other.**
- **READ COMMITTED is enough** because the lock does the serializing: each
  statement after the lock sees everything committed before it. It's set
  explicitly anyway.

**The fairness rule** (pure function, `domain/allocation.ts`):
`free = waitlistExists ? 0 : capacity − confirmed`. A seat freed by a
cancellation belongs to the waitlist and is handed out at chart preparation;
nobody can grab it first. Group bookings are split per passenger (4 people with
3 seats free → 3 CONFIRMED + 1 WAITLISTED on one PNR).

**Database time, read after the lock:** the window check uses
`clock_timestamp()`, not `now()`. PostgreSQL's `now()` is frozen at transaction
start, and a booking can queue for the lock for seconds. The booking insert also
sets `created_at = clock_timestamp()`, so booking order equals decision order,
which the fair-ordering check and seat matching rely on. (A deliberate deviation
from the original design, adopted after demonstrating the difference with
`pg_sleep`.)

**Idempotency:** the client sends one `Idempotency-Key` per booking attempt,
stored under `UNIQUE(user_id, idempotency_key)`.

- A retry gets the original booking back (HTTP 200).
- Two identical requests at the same instant are caught again under the lock.
- The same key racing in two _different_ classes is caught by the insert's
  `ON CONFLICT DO NOTHING`, which returns "no row" instead of aborting the
  transaction.

**The PNR insert is raw SQL** (`INSERT … ON CONFLICT DO NOTHING RETURNING id`,
up to 5 retries). In PostgreSQL, a failed statement (such as a Prisma `create`
hitting a UNIQUE constraint) aborts the whole transaction, lock and all.

**Prisma settings that matter under load:** `timeout` 15 s and `maxWait` 10 s
(the defaults of 5 s and 2 s would turn a burst into errors). The pool size
comes from `connection_limit` in `DATABASE_URL`, which the pg adapter needs as
`max`.

### Proof: the tests fail without the lock

With **only** `FOR UPDATE` deleted from `lockClassInventory`, 3 of 5 concurrency
tests failed. 120 simultaneous single-passenger bookings in a 40-seat class
produced:

| Run | CONFIRMED (capacity 40) | Requests then refused by the domain's own guard |
| --- | ----------------------- | ----------------------------------------------- |
| 1   | **68**                  | 52 / 120                                        |
| 2   | **64**                  | 56 / 120                                        |
| 3   | **68**                  | 52 / 120                                        |

With the lock restored: exactly 40 CONFIRMED and WL 1–80 (gap-free, unique),
five runs in a row. The two idempotency tests still passed without the lock,
because they're protected by a UNIQUE constraint, not by the lock.

### Load test: 500 simultaneous bookings

`apps/api/scripts/loadTest.ts` signs in 500 users, then fires 500 single-seat
Sleeper bookings at the same instant over HTTP, against the Docker Compose stack
(pool of 20 connections) on a MacBook Air (Apple Silicon):

| Run | Result                                          | Wall time | Throughput     | Latency p50 / p99 / max |
| --- | ----------------------------------------------- | --------- | -------------- | ----------------------- |
| 1   | 201 × 500; exactly 40 CONFIRMED, 460 WAITLISTED | 1.37 s    | 365 bookings/s | 1294 / 1351 / 1361 ms   |
| 2   | same                                            | 1.33 s    | 375 bookings/s | 1256 / 1308 / 1317 ms   |

This matches the design estimate that "the last of 500 waits roughly one to two
seconds". Latencies cluster near the end rather than spreading out; the
server-side `responseTime` logs show the same (min 1227 ms), so it isn't Docker
networking. One coarse sample showed the API at ~80% CPU and PostgreSQL at
~65%. **Hypothesis, not yet proven:** the single Node.js event loop interleaves
all 500 requests, so they finish together. Profiling the event loop would
settle it.

---

## Chart preparation

`POST /api/admin/chart/prepare` runs **one atomic, idempotent transaction**
(`services/chartService.ts`):

1. Lock `train_run`. If it's already CHART_LOCKED, return the existing summary.
   If the window is still open, return `WINDOW_STILL_OPEN`. A window closed only
   by time is marked CLOSED inside this transaction.
2. Lock every `class_inventory` row, `ORDER BY class_code`.
3. Per class, promote the first `capacity − confirmed` WAITLISTED passengers by
   `waitlist_number` (one set-based UPDATE).
4. Expire everyone not reached: WAITLIST_EXPIRED, not CANCELLED (a system
   outcome, not a user action).
5. **Seat matching** (pure function), in booking order: the first coach with
   enough consecutive free seats keeps a group together; otherwise the coach with
   the most free seats, splitting only as a last resort. Then one INSERT of
   every allocation.
6. **Verify the invariants inside the transaction.** Any violation throws and
   rolls everything back.
7. Set CHART_LOCKED and commit.

**A crash anywhere = full rollback; the run stays CLOSED, so rerunning is safe.**
That's tested by throwing after the seat insert (then rerunning) and by
corrupting the chart before verification. A cancellation racing chart prep
either commits first (no seat) or waits on the class lock and gets
`CHART_LOCKED`. That's tested by pausing chart prep mid-transaction and showing
the cancellation is blocked.

---

## PNR design

10 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (31 symbols, no 0/O/1/I/L),
each picked with `crypto.randomInt`, a cryptographically secure generator. Lint
bans `Math.random`.

- **Non-guessable:** 31¹⁰ ≈ 8 × 10¹⁴ combinations.
- **Unique by construction, not by probability:** `UNIQUE(pnr)` plus the
  ON CONFLICT retry. The collision path is tested with an injected random source.
- **A lookup handle, not a credential:** bookings are visible only to their
  owner. Another user's PNR, an unknown PNR and a malformed PNR all return the
  same 404.

---

## Trade-offs

| Decision                                           | Alternative                          | Why this one                                                                                                                    |
| -------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Pessimistic lock, one row per class                | Optimistic versioning; SERIALIZABLE  | One hot row makes optimistic locking a retry storm; SERIALIZABLE needs retry logic everywhere and is harder to reason about     |
| Lock the class row                                 | Lock seat rows with `SKIP LOCKED`    | Seats are assigned only at chart time; SKIP LOCKED isn't first-come-first-served; the waitlist needs one ordered decision point |
| Promote at chart time                              | Promote live on each cancellation    | Matches the requirement; keeps cancellation trivial; the fairness rule reserves the seat for the waitlist meanwhile             |
| Status per passenger                               | All-or-nothing per booking           | All-or-nothing forces skipping WL 1 (unfair) or wasting seats when a group doesn't fit                                          |
| One terminal chart state                           | PREPARING / PREPARED states          | Preparation is one transaction; an intermediate value is never visible to anyone                                                |
| Compute the confirmed count                        | Store a counter                      | Normalized and cheap at this size; a counter is a scale optimization                                                            |
| PostgreSQL only                                    | Redis / distributed lock             | A second store means two sources of truth and lock-expiry edge cases                                                            |
| Polling every 5 s                                  | WebSockets                           | Stateless API, works through any proxy; data changes rarely                                                                     |
| Next.js rewrites `/api`                            | Calling the API cross-origin         | One origin: first-party cookie, no CORS                                                                                         |
| `clock_timestamp()`                                | `now()` (original spec)              | `now()` is frozen at transaction start; see Concurrency design                                                                  |
| Images run with dev dependencies and `tsx`         | A compiled, slimmed production image | Simpler for a demo; the images are ~3 GB and run as root (production should build, prune and use a non-root user)               |
| `package-lock.json` not committed (project choice) | Committed lockfile + `npm ci`        | Fresh installs may resolve newer minor versions; committing the lockfile would make builds reproducible                         |

---

## Scaling to production

The per-class lock that's right here becomes the bottleneck when thousands of
trains open at the same minute (Tatkal at 10:00). The answer is to spread
contention, smooth spikes and separate reads from writes, while the database (or
a single writer) stays the only authority on seats.

| Pressure                         | Change                                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| One hot inventory row per class  | Split capacity into sub-buckets claimed with `SKIP LOCKED`, or a single-writer service per train run backed by a log |
| Traffic far above write capacity | A virtual waiting room that admits users at a sustainable rate                                                       |
| API CPU (see the load test)      | Several stateless API instances behind a load balancer: safe, since no state lives in the process                    |
| Payments                         | Two-phase booking: HOLD with a time limit, then CONFIRMED; expired holds return to inventory                         |
| Multi-station journeys           | Inventory per seat per segment                                                                                       |
| Status reads                     | Read replicas or a cache for `GET /api/run` and PNR status                                                           |
| Many charts per day              | Scheduled, idempotent chart jobs per run (`prepareChart` is already idempotent and crash-safe), with alerting        |
| Confirmed count                  | A stored counter with `CHECK(confirmed <= capacity)`, reconciled periodically                                        |
| Data growth                      | Partition bookings by journey date; archive completed journeys                                                       |
| Operations                       | Real authentication, rate limiting, bot protection, notifications, metrics on lock wait and latency                  |

---

## Testing strategy

| Layer       | Where                                                       | What                                                                                                                                   | Count       |
| ----------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Unit        | `apps/api/src/domain/*.test.ts`                             | Every allowed and forbidden state transition, the fairness rule, seat matching, PNR, derived status; **100% branch coverage enforced** | 173         |
| Integration | `apps/api/test/*Service.test.ts`                            | Booking, cancellation, window, chart against real PostgreSQL 16 (testcontainers)                                                       | 71          |
| Concurrency | `bookingConcurrency`, `cancellationService`, `chartService` | 120-way race, mixed groups, idempotency races, cancel vs book, cancel vs chart (natural and forced order)                              | (in the 71) |
| Schema      | `schemaConstraints.test.ts`                                 | Each hand-added CHECK exists (valid control + invalid write)                                                                           | 6           |
| API         | `apiSession`, `apiBookings` (Supertest)                     | Every endpoint, every error code, 401/403, idempotent replay, 30 parallel HTTP bookings; responses parsed with the shared schemas      | 47          |
| Browser     | README checklist                                            | Ran in headless Chrome against the Docker stack                                                                                        | 17 checks   |
| Load        | `scripts/loadTest.ts`                                       | 500 simultaneous bookings                                                                                                              | 2 runs      |

- **The invariant checker** (`apps/api/test/invariants.ts`) runs six SQL
  queries, one per invariant rule, after **every** integration and concurrency
  test. Every query must return zero rows.
- **Concurrency tests use separate connections** (pool 150 for 120 requests). A
  shared connection would quietly serialize everything and let a broken
  implementation pass.
- **Tests were made to fail on purpose:** remove the lock (above), drop a CHECK,
  remove the cancellation lock, add an untested domain file. Each time, the
  corresponding test failed.

---

## Manual QA checklist (browser)

Two browser profiles: **admin** signs in as `admin@example.com`, **user** as any
other email.

1. [ ] User: sign in → booking form; the stepper shows **Not open**.
2. [ ] Admin: **Admin** → _Open window_; within 5 s the user's stepper shows **Booking open** (no reload).
3. [ ] User: submit with a blank name → inline error; nothing is booked.
4. [ ] User: book AC 6 + 6 + 6 passengers → each **Confirmed**, with a big PNR.
5. [ ] User: book AC with 4 → **Partially confirmed**: 2 confirmed + WL 1, WL 2, and the "group was split" note.
6. [ ] User: book AC with 1 → **Waitlisted, WL 3**; the class selector says "waitlist".
7. [ ] User: _My bookings_ → _Cancel_ the first booking → confirm → **Cancelled**; WL 3 still waiting.
8. [ ] Admin: _Close window_ → within 5 s the user's stepper shows **Booking closed**.
9. [ ] Admin: _Prepare chart_ → AC: promoted 3, expired 0, 17 / 20; the seat map shows names in booking order.
10. [ ] User: the split booking shows seats (`A1-13` … `A1-16`) and "Promoted from WL 1/2"; no _Cancel_ buttons; the stepper shows **Chart prepared & locked**.

Last run 2026-10-13: all passed (local dev and Docker Compose).

---

## API

All JSON. The session is a signed, HTTP-only cookie. Every error is
`{ "error": { "code", "message", "details"? } }`. The schemas are in
`packages/shared`.

| Method & path                            | Auth  | Success                          | Notes                                                               |
| ---------------------------------------- | ----- | -------------------------------- | ------------------------------------------------------------------- |
| `GET /api/run`                           | none  | 200 `RunSummaryDto`              | effective chart status; `available` is 0 while anyone is waitlisted |
| `POST /api/session`                      | none  | 200 `{ email, isAdmin }`         | email-only demo sign-in; sets the cookie                            |
| `GET /api/session`                       | user  | 200 `{ email, isAdmin }`         | 401 if signed out                                                   |
| `DELETE /api/session`                    | none  | 204                              | clears the cookie                                                   |
| `POST /api/bookings`                     | user  | 201 (200 on replay) `BookingDto` | header `Idempotency-Key` (UUID)                                     |
| `GET /api/bookings`                      | user  | 200 `BookingDto[]`               | newest first                                                        |
| `GET /api/bookings/:pnr`                 | user  | 200 `BookingDto`                 | 404 unless yours                                                    |
| `POST /api/bookings/:pnr/cancel`         | user  | 200 `BookingDto`                 | whole PNR; idempotent                                               |
| `POST /api/admin/window/open` · `/close` | admin | 200 `RunSummaryDto`              | repeating is a no-op                                                |
| `POST /api/admin/chart/prepare`          | admin | 200 `ChartSummaryDto`            | idempotent                                                          |
| `GET /api/admin/chart`                   | admin | 200 `ChartDto`                   | seat map by coach                                                   |

Error codes: `BOOKING_CLOSED`, `CHART_LOCKED`, `WINDOW_STILL_OPEN`,
`INVALID_WINDOW_TRANSITION` (409) · `VALIDATION_FAILED` (422) · `NOT_FOUND` (404)
· `UNAUTHENTICATED` (401) · `FORBIDDEN` (403) · `INTERNAL_ERROR` (500).

### curl walkthrough

With the API running (`ADMIN_EMAILS=admin@example.com`), from an empty folder.
Cookie jars hold the session:

```bash
API=http://localhost:4000/api
J='content-type: application/json'

curl -s $API/run                                                            # public status
curl -s -c admin.txt -H "$J" -d '{"email":"admin@example.com"}' $API/session
curl -s -c asha.txt  -H "$J" -d '{"email":"asha@example.com"}'  $API/session
curl -s -b admin.txt -X POST $API/admin/window/open

KEY=$(uuidgen)
curl -s -b asha.txt -H "$J" -H "Idempotency-Key: $KEY" \
  -d '{"classCode":"AC","passengers":[{"name":"Asha"},{"name":"Ravi"}]}' $API/bookings   # 201
curl -s -b asha.txt -H "$J" -H "Idempotency-Key: $KEY" \
  -d '{"classCode":"AC","passengers":[{"name":"Asha"},{"name":"Ravi"}]}' $API/bookings   # 200, same PNR

curl -s -b asha.txt $API/bookings                                           # my bookings
curl -s -b admin.txt -X POST $API/admin/window/close
curl -s -b admin.txt -X POST $API/admin/chart/prepare
curl -s -b asha.txt $API/bookings                                           # now with seat labels
curl -s -b admin.txt $API/admin/chart                                       # seat map

curl -s $API/bookings                                                       # 401 UNAUTHENTICATED
curl -s -b asha.txt -X POST $API/admin/window/open                          # 403 FORBIDDEN
PNR=$(curl -s -b asha.txt $API/bookings | sed -E 's/.*"pnr":"([A-Z0-9]{10})".*/\1/')
curl -s -b asha.txt -X POST $API/bookings/$PNR/cancel                       # 409 CHART_LOCKED
```

Verified end to end on 2026-10-13.

---

## Repository layout

```
apps/api/          Express API: src/{domain,services,repositories,routes,http}, test/, scripts/loadTest.ts
apps/web/          Next.js App Router frontend: app/, components/, lib/
packages/shared/   Zod schemas + types: the API contract
prisma/            schema.prisma, migrations/ (with hand-added CHECKs), seed.ts
Dockerfile  docker-compose.yml  .github/workflows/ci.yml  AI_USAGE.md
```

## AI usage

Built with Claude Code as a pair programmer. Every task, what it produced and
how it was verified is logged in [AI_USAGE.md](AI_USAGE.md).
