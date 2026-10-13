# Mini Railway Reservation System

IRCTC-style booking for one train, one journey date, two classes (Sleeper 40,
AC 20). Work in progress: the full README (architecture, concurrency design,
trade-offs) comes in Phase 8. See `docs/` for the design spec and plan.

## Quick start (local)

```bash
cp .env.example .env                 # once
docker compose up -d db              # PostgreSQL 16
npm install
npm run db:migrate && npm run db:seed
npm run dev -w @railway/api          # API on http://localhost:4000
```

`npm run db:reset` wipes the dev database, re-applies migrations and reseeds.
Use it to start the walkthrough below from scratch.

## API walkthrough (curl)

Uses `ADMIN_EMAILS=admin@example.com` from `.env.example`. Cookie jars keep the
signed session cookie between calls. Run from any empty folder, with the API running.

```bash
API=http://localhost:4000/api
J='content-type: application/json'

# 1. Public status (effective chart status + per-class availability)
curl -s $API/run

# 2. Sign in (demo-grade, email only); -c stores the session cookie
curl -s -c admin.txt -H "$J" -d '{"email":"admin@example.com"}' $API/session
curl -s -c asha.txt  -H "$J" -d '{"email":"asha@example.com"}'  $API/session

# 3. Admin opens the booking window
curl -s -b admin.txt -X POST $API/admin/window/open

# 4. Book two passengers in AC → 201 with PNR and per-passenger status
KEY=$(uuidgen)
curl -s -b asha.txt -H "$J" -H "Idempotency-Key: $KEY" \
  -d '{"classCode":"AC","passengers":[{"name":"Asha"},{"name":"Ravi"}]}' $API/bookings

# 5. Retry with the same Idempotency-Key → 200, the same booking (no duplicate)
curl -s -b asha.txt -H "$J" -H "Idempotency-Key: $KEY" \
  -d '{"classCode":"AC","passengers":[{"name":"Asha"},{"name":"Ravi"}]}' $API/bookings

# 6. My bookings (newest first)
curl -s -b asha.txt $API/bookings

# 7. Admin closes the window and prepares the chart
curl -s -b admin.txt -X POST $API/admin/window/close
curl -s -b admin.txt -X POST $API/admin/chart/prepare

# 8. Seat labels now appear (e.g. "A1-01"); the admin seat map
curl -s -b asha.txt $API/bookings
curl -s -b admin.txt $API/admin/chart

# 9. Errors use one shape: {"error":{"code":"…","message":"…"}}
curl -s $API/bookings                                  # 401 UNAUTHENTICATED
curl -s -b asha.txt -X POST $API/admin/window/open     # 403 FORBIDDEN
PNR=$(curl -s -b asha.txt $API/bookings | sed -E 's/.*"pnr":"([A-Z0-9]{10})".*/\1/')
curl -s -b asha.txt -X POST $API/bookings/$PNR/cancel  # 409 CHART_LOCKED
```

Verified end to end on 2026-10-13 (responses: 201 → 200 replay → seat labels
`A1-01`, `A1-02` → 401 / 403 / 409).

## API

| Method & path                           | Auth  | Success                          | Notes                                                         |
| --------------------------------------- | ----- | -------------------------------- | ------------------------------------------------------------- |
| `GET /api/run`                          | none  | 200 `RunSummaryDto`              | effective status; `available` is 0 while anyone is waitlisted |
| `POST /api/session`                     | none  | 200 `{ email, isAdmin }`         | sets signed HTTP-only cookie                                  |
| `GET /api/session`                      | user  | 200 `{ email, isAdmin }`         | 401 if signed out                                             |
| `DELETE /api/session`                   | none  | 204                              | clears the cookie                                             |
| `POST /api/bookings`                    | user  | 201 (200 on replay) `BookingDto` | header `Idempotency-Key` (UUID)                               |
| `GET /api/bookings`                     | user  | 200 `BookingDto[]`               | newest first                                                  |
| `GET /api/bookings/:pnr`                | user  | 200 `BookingDto`                 | 404 unless yours                                              |
| `POST /api/bookings/:pnr/cancel`        | user  | 200 `BookingDto`                 | whole PNR, idempotent                                         |
| `POST /api/admin/window/open` / `close` | admin | 200 `RunSummaryDto`              | repeat = no-op                                                |
| `POST /api/admin/chart/prepare`         | admin | 200 `ChartSummaryDto`            | idempotent                                                    |
| `GET /api/admin/chart`                  | admin | 200 `ChartDto`                   | seat map by coach                                             |

Error codes: `BOOKING_CLOSED`, `CHART_LOCKED`, `WINDOW_STILL_OPEN`,
`INVALID_WINDOW_TRANSITION` (409) · `VALIDATION_FAILED` (422) · `NOT_FOUND` (404)
· `UNAUTHENTICATED` (401) · `FORBIDDEN` (403) · `INTERNAL_ERROR` (500).
Schemas: `packages/shared`.
