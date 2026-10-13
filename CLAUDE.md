# Mini Railway Reservation System

IRCTC-style booking for ONE train, ONE journey date, fixed seats in two classes
(Sleeper 40, AC 20). Bookings get a PNR and CONFIRMED / WAITLISTED status per
passenger; after the booking window closes, chart preparation promotes the
waitlist, assigns real seat numbers (e.g. S1-07) and locks the chart.

The design is FINAL and was approved by the reviewer. Do not redesign it.
- Machine setup (macOS, Apple Silicon): `docs/SETUP.md`. Docker Desktop must
  be running for the database and tests. If a tool is missing, tell me which
  SETUP.md step to redo; don't install system software yourself.
- Full spec: `docs/DESIGN_SPEC.md` (read the relevant section before each task)
- Background reasoning: `docs/reference/system-design.md` (the approved design
  doc). Use it for the "why" behind decisions and for interview answers. If it
  conflicts with `docs/DESIGN_SPEC.md`, DESIGN_SPEC wins.
- Work plan: `docs/IMPLEMENTATION_PLAN.md` (follow phases in order)

## How to work with me

I am learning while building. I must be able to explain every file and every
decision in an interview, so teaching me is part of the job, not an extra.

- I am new to TypeScript. When you introduce a pattern (generics, Zod inference,
  Prisma transaction client types, Express 5 error handling), explain it in 2–3
  sentences the first time it appears.
- Work one phase task at a time. After each task: run lint, typecheck and tests,
  then give a short summary of what changed.
- If the spec is ambiguous or seems wrong, ask. Do not silently pick something.
- Append a line to `AI_USAGE.md` for each task: what you generated, what I
  should verify. I will add how I validated it.

### End-of-phase learning checkpoint (MANDATORY, every phase)

When a phase's "done when" passes, do NOT start the next phase. Instead:

1. **Write `docs/learning/phase-N.md`** containing:
   - **File map:** a table of every file created or changed in this phase:
     path, its one-line job, and which other files use it.
   - **Code walkthrough:** for each important file, walk through the code in
     execution order (e.g. "a booking request enters `routes/bookings.ts`, Zod
     parses it, then `bookingService.createBooking` opens the transaction…").
     Quote short code snippets and explain each line that matters: what it
     does AND why it is written that way (which invariant or spec § it serves).
   - **TypeScript / library concepts used** for the first time, explained simply.
   - **What would break if…:** 3–5 lines removed or changed, and the exact
     consequence (which test fails, which invariant breaks).
   - **Interview questions, theory:** 8–10 questions a senior engineer would ask
     about this phase, each with a model answer of 3–6 sentences in plain
     spoken English (how I would say it on a call).
   - **Interview questions, change requests:** 3–5 "how would you change the
     code to…" questions (see the seeds in the plan), each with the files that
     would change, the steps, and the risk to watch for.
2. **Walk me through it live in chat:** summarise the file map, then go file by
   file in execution order. Pause after each file and ask if I have questions.
3. **Quiz me:** ask me 5 of the theory questions one at a time, WITHOUT showing
   the answers. Wait for my answer, then grade it (correct / partly / missing),
   tell me what a strong answer adds, and move on. Then give me one change
   request to talk through.
4. Only when I say "next phase" do you continue.

## The four invariants (everything protects these)

1. **Capacity:** CONFIRMED passengers per class ≤ class capacity.
2. **Seat uniqueness:** a physical seat is allocated to at most one passenger.
3. **Fair ordering:** the waitlist is promoted strictly by waitlist number; a new
   booking never gets a seat while anyone in that class is WAITLISTED.
4. **Chart finality:** once CHART_LOCKED, nothing changes.

## Stack (mandated, do not substitute)

TypeScript strict everywhere, no `any` · Node.js + Express 5 · Zod (body, params
and query parsed together) · Prisma ORM, one shared client · Prisma Migrate
(`migrate dev --create-only`, edit SQL, then `migrate deploy`) · PostgreSQL 16 ·
React + Next.js App Router + Tailwind · TanStack Query · Jest + Supertest ·
testcontainers for Node · ESLint + Prettier · pino logging.

Use current stable versions. If the installed Prisma/Next.js version's API
differs from what you expect, check its docs rather than guessing.

## Hard rules

### Transactions and locking
- Every seat-affecting use case (book, cancel, prepare chart) is ONE
  `prisma.$transaction(async (tx) => { ... }, { isolationLevel: ReadCommitted,
  timeout: 15000, maxWait: 10000 })`.
- Inside a transaction use ONLY `tx`. Never the global `prisma`: it runs on a
  different connection, outside the transaction and outside the lock.
  Repository functions take the transaction client as their first parameter.
- Row locks are raw SQL: `tx.$queryRaw\`SELECT ... FOR UPDATE\``. Prisma's query
  API cannot lock rows.
- Booking and cancellation take exactly ONE lock: their `class_inventory` row.
- Chart prep locks `train_run` FOR UPDATE, then ALL `class_inventory` rows
  ordered by `class_code`. Never take locks in any other order.
- Window/time checks use the database clock inside the locked transaction, never
  `Date.now()`: `clock_timestamp()` read after the lock, NOT `now()` (which is
  frozen at transaction start). See DESIGN_SPEC §4 step 4.

### Raw SQL
- Only in `apps/api/src/repositories/`. Only tagged templates (`$queryRaw`,
  `$executeRaw`, `Prisma.sql`). NEVER `$queryRawUnsafe` / `$executeRawUnsafe`.
- PNR insert is raw `INSERT ... ON CONFLICT (pnr) DO NOTHING RETURNING id` with
  up to 5 retries. A Prisma `create` that violates a unique constraint aborts the
  whole Postgres transaction.
- CHECK constraints are hand-added to the `--create-only` migration SQL.

### Code organisation
- `src/domain/`: pure functions only (no Prisma, no Express, no I/O): state
  transitions, fairness rule, seat matching, PNR generation, booking-status
  derivation. Unit-tested without a database.
- `src/services/`: own the transaction, orchestrate domain + repositories.
- `src/repositories/`: all database access.
- `src/routes/`: Zod parsing, call service, map result to HTTP. No business logic.
- Shared Zod schemas and types live in `packages/shared`, used by API and web.

### Safety and quality
- PNRs: `crypto.randomInt` only. Never `Math.random`.
- No `console.log`. Use the pino logger (request-scoped child logger in routes).
- No `any`, no `@ts-ignore`, no non-null `!` without a comment saying why.
- Errors are a typed `AppError(code, httpStatus)`; one Express error middleware
  maps them. Error codes: BOOKING_CLOSED 409, CHART_LOCKED 409,
  WINDOW_STILL_OPEN 409, INVALID_WINDOW_TRANSITION 409 (admin open/close not
  allowed from the current state; see DESIGN_SPEC §2), VALIDATION_FAILED 422,
  NOT_FOUND 404, UNAUTHENTICATED 401, FORBIDDEN 403.
- Booking status (Confirmed / Partially confirmed / Waitlisted / Cancelled) is
  DERIVED from passengers. Never store it.

### Out of scope (do not build)
Payments, RAC, quotas, multi-station journeys, berth preferences, refunds,
notifications, real auth, Redis, queues, schedulers, microservices,
public PNR lookup, waitlist cap, per-passenger cancellation.

## Testing rules

- Integration and concurrency tests run against REAL PostgreSQL (testcontainers
  or the Compose `db` service). Never mock the database for these.
- Concurrency tests must run requests on SEPARATE database connections in
  parallel (pool `connection_limit` ≥ number of concurrent requests). A single
  shared connection serialises everything and hides bugs.
- After every integration/concurrency test, run the SQL invariant checker
  (`apps/api/test/invariants.ts`); every query must return zero rows.

## Commands (keep this section updated as scripts are added)

```bash
cp .env.example .env                 # once; Prisma 7 needs DATABASE_URL even to generate
docker compose up -d db              # start Postgres
npm install                          # install all workspaces
npm run db:migrate                   # prisma migrate deploy
npm run db:generate                  # prisma generate → apps/api/src/generated/prisma (typecheck runs it too)
npm run db:seed                      # seed train, run, coaches, seats (idempotent)
npm run dev                          # api + web
npm run lint && npm run typecheck    # must pass before every commit
npm run format                       # Prettier (docs/ and CLAUDE.md are excluded)
npm test                             # all tests
npm run test:coverage                # api tests + 100% coverage gate on src/domain/
```

## Repository layout

```
apps/api/      Express API (src/domain, src/services, src/repositories, src/routes, test/)
apps/web/      Next.js App Router frontend
packages/shared/  Zod schemas + types shared by api and web
prisma/        schema.prisma, migrations/, seed.ts
docs/          SETUP.md, DESIGN_SPEC.md, IMPLEMENTATION_PLAN.md, learning/phase-N.md
docker-compose.yml  README.md  AI_USAGE.md
```
