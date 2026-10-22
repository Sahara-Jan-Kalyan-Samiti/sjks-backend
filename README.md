# sjks-backend

[![CI](https://github.com/scalric/sjks-backend/actions/workflows/ci.yml/badge.svg)](https://github.com/scalric/sjks-backend/actions/workflows/ci.yml)

Node.js API of the **Sahara Jan Kalyan Samiti** platform. It does only the work that must run on a server: the Razorpay payment webhook, donation receipts, e-mail (documents, receipts, broadcasts), exports and the public form endpoints.

| Repository                  | What it is                                         |
| --------------------------- | -------------------------------------------------- |
| sjks-frontend               | Public website (Next.js)                           |
| sjks-admin                  | Admin panel (React)                                |
| **sjks-backend** (this one) | Node API on Cloud Run                              |
| sjks-database               | Supabase migrations, access rules, storage buckets |

## Tech stack

Node.js 20.6 or newer (see `.nvmrc`) · TypeScript · Express 4 · Zod (validation) · Supabase JS (service role) · nodemailer · Vitest + Supertest

## What lives here and what does not

| Done by this API                                | Done by the browser directly against Supabase (row-level security protects it)                  |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Razorpay webhook → donations                    | Reading public content (gallery, blog, awards, team, reports)                                   |
| Receipts (print page, e-mail), 80G certificates | Admin CRUD: events, projects, volunteers, team, blog, photos, page text                         |
| E-mailing documents to requesters               | Recording or editing a donation (database logs it)                                              |
| Broadcast e-mail                                | Uploading files to Storage                                                                      |
| CSV export                                      | Public form inserts through SQL functions (this API offers the same as a validated alternative) |
| Public `events` / `projects` JSON               |                                                                                                 |

## Getting started

```bash
npm ci
cp .env.example .env          # fill SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
npm run dev                   # http://localhost:8080  (restarts on change)
curl http://localhost:8080/health    # alive
curl http://localhost:8080/ready     # alive and the database answers
```

| Script                                          | Purpose                                                      |
| ----------------------------------------------- | ------------------------------------------------------------ |
| `npm run dev`                                   | Watch mode (loads `.env`)                                    |
| `npm run typecheck` / `npm run lint`            | Static checks                                                |
| `npm test`                                      | Tests (payment rules, auth and roles, forms, receipts, CORS) |
| `npm run build` / `npm start`                   | Compile to `dist/` and run it                                |
| `npm run migrate:sqlite -- <data.db> [--apply]` | One-off import from the old SQLite server                    |

## Folder structure

```
src/
  server.ts               Entry: reads settings, starts Express, shuts down cleanly on SIGTERM
  app.ts                  Builds the app from its dependencies (so tests can swap them)
  config/
    env.ts                Environment variables, validated with Zod (the server refuses to start if wrong)
    org.ts, org.json      Organisation identity and tax-receipt settings (80G / 12A numbers)
  middleware/
    requireAuth.ts        Supabase access token → active staff member; requireRole(...)
    rateLimit.ts          Per-IP limits (forms: 5 per 15 minutes)
    requestContext.ts     Request id and one log line per request
    errorHandler.ts       asyncHandler, JSON errors; server errors are logged, never shown
  routes/                 Thin: read and validate the request, call a service, send the response
    health.ts             GET /health (alive), GET /ready (database reachable)
    public.ts             GET /api/public/events, /api/public/projects
    siteForms.ts          POST /api/public/document-requests, /api/public/volunteers
    webhooks.ts           POST /api/webhooks/razorpay
    donations.ts          Receipt page, e-mail receipt, CSV export
    requests.ts           E-mail the documents of a request
    broadcast.ts          Broadcast e-mail
    admins.ts             Create staff accounts
  services/               The actual work: queries, rules and e-mails (no Express in here)
    payments.ts           Webhook rules (idempotent, forward-only states, refunds)
    paymentStore.ts       Supabase implementation of the payment store
    donations.ts          Load a donation, CSV export, e-mail a receipt or 80G certificate
    documentRequests.ts   Request references, default message, e-mail the documents
    broadcast.ts          Audiences, sending in BCC batches
    adminAccounts.ts      Create a staff account and its profile
    publicContent.ts      Public events and projects, volunteer sign-up
    receipts.ts           Receipt and 80G certificate HTML
    mailer.ts, activity.ts, supabase.ts
  utils/                  money (paise), csv, validators (Zod), errors, logger
tests/                    helpers.ts (fakes), payments / api / routes / utils tests
scripts/migrate-sqlite.ts One-off data import
Dockerfile · cloudbuild.yaml · .github/workflows/ci.yml
```

## API

Staff routes need `Authorization: Bearer <Supabase access token>` of a user with an **active** row in `admin_profiles`. Errors are `{ "error": "message" }`.

| Method | Path                                  | Who                       | Purpose                                                                                                    |
| ------ | ------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| GET    | `/health`                             | anyone                    | Liveness check (the process is running)                                                                    |
| GET    | `/ready`                              | anyone                    | Readiness check: 200 only if Supabase answers, otherwise 503                                               |
| GET    | `/api/public/events`                  | anyone                    | Published events (images are full Storage URLs)                                                            |
| GET    | `/api/public/projects`                | anyone                    | Published projects                                                                                         |
| POST   | `/api/public/document-requests`       | anyone, 5 per 15 min      | Document request from the website                                                                          |
| POST   | `/api/public/volunteers`              | anyone, 5 per 15 min      | Volunteer sign-up                                                                                          |
| POST   | `/api/public/donations/order`         | anyone, 10 per 15 min     | Create a Razorpay order for the donate page (amount, name, email, optional PAN)                            |
| POST   | `/api/public/donations/verify`        | anyone                    | Check the signed payment proof returned by Razorpay Checkout                                               |
| GET    | `/api/public/donations/receipt`       | donor (signed proof)      | Printable receipt for a successful website donation                                                        |
| POST   | `/api/webhooks/razorpay`              | Razorpay (HMAC signature) | Record payments and refunds; e-mails the donor's receipt when a payment is captured                        |
| GET    | `/api/donations/:id/receipt?type=tax` | admin, editor             | Printable receipt or 80G certificate                                                                       |
| POST   | `/api/donations/:id/send-receipt`     | admin                     | E-mail it to the donor. Body `{ "type": "tax" }` optional                                                  |
| GET    | `/api/exports/donations.csv`          | admin                     | All donations (formula-injection safe)                                                                     |
| GET    | `/api/requests/:id/default-message`   | admin, editor             | Pre-filled message for the documents e-mail                                                                |
| POST   | `/api/requests/:id/send`              | admin                     | E-mail the attached documents. Body `{ subject, message }`                                                 |
| GET    | `/api/broadcast`                      | admin                     | Audience sizes and history                                                                                 |
| POST   | `/api/admins`                         | admin                     | Create a staff account (service role; public sign-up stays off). Body `{ email, password, display_name? }` |
| POST   | `/api/broadcast`                      | admin                     | Send. Body `{ audience: "volunteers"                                                                       | "donors" | "all", subject, message }` |

### Payment rules (tested in `tests/payments.test.ts`)

1. The body is checked against the `X-Razorpay-Signature` HMAC **before** it is parsed.
2. Every event id is stored in `payment_webhook_events` (unique). A repeated delivery is acknowledged and ignored.
3. A payment only moves forward: `pending → success → refunded`, or `pending → failed`. A late `authorized` never undoes a `captured` payment.
4. A full refund sets `refunded`; a partial refund keeps `success` and writes the refunded amount into the donation notes.
5. Donor details typed by an admin are never overwritten by the payment's details.
6. If processing fails, the event id is forgotten and the server answers 500, so Razorpay's retry is handled.

## Environment variables

See `.env.example`. In production, secrets come from **Google Secret Manager** (never from git).

| Variable                                                    | Secret        | Purpose                                                                                            |
| ----------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------- |
| `SUPABASE_URL`                                              | no            | Project URL                                                                                        |
| `SUPABASE_SERVICE_ROLE_KEY`                                 | **yes**       | Full database access                                                                               |
| `RAZORPAY_KEY_ID` `RAZORPAY_KEY_SECRET`                     | secret: **yes** | Create orders for the website donate page and check payment proof. Optional: without them the donate form says online payment is not configured        |
| `RAZORPAY_WEBHOOK_SECRET`                                   | **yes**       | Verify webhooks. Required when `NODE_ENV=production`: the server refuses to start without it       |
| `CORS_ORIGINS`                                              | prod          | Website and admin origins, comma separated. Locally: `http://localhost:3000,http://localhost:5174` |
| `TRUST_PROXY`                                               | no            | `true` on Cloud Run                                                                                |
| `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASS` `SMTP_FROM` | pass: **yes** | Outgoing e-mail (without it, send endpoints answer 503 with a clear message)                       |
| `PORT`                                                      | no            | Set by Cloud Run (8080)                                                                            |

## Deployment (Google Cloud Run)

1. Artifact Registry repository `sjks` and a Cloud Run service per environment (`sjks-backend-staging`, `sjks-backend-prod`), region `asia-south1`.
2. Store the secrets in Secret Manager: `supabase-service-role-key`, `razorpay-webhook-secret`, `smtp-host`, `smtp-user`, `smtp-pass`, `smtp-from`; give the Cloud Run service account the _Secret Manager Secret Accessor_ role.
3. Create a Cloud Build trigger per branch (`stage` → staging, `main` → production) using `cloudbuild.yaml` and set the substitutions `_SERVICE`, `_CORS_ORIGINS`, `_SUPABASE_URL`.
4. Map the domain `api.saharangosag.com` to the service.
5. Set the Razorpay webhook to `https://api.saharangosag.com/api/webhooks/razorpay` with the same secret.
6. Create an uptime check on `/health` (and use `/ready` to confirm the database connection after a deploy) and alerts for 5xx responses and for webhook failures (search the logs for `razorpay webhook` with severity ERROR).

`cloudbuild.yaml` keeps 1 instance warm (`--min-instances=1`) so webhooks are never delayed by a cold start. The rate limiter is in memory per instance; with more than one instance, switch it to a shared store.

## Migrating the old SQLite data

```bash
npm run migrate:sqlite -- /path/to/data.db            # dry run
npm run migrate:sqlite -- /path/to/data.db --apply    # copy into Supabase
```

Not migrated on purpose: `admin_users` (create the staff in Supabase Auth and run `create_admin_profile.sql` from `sjks-database`), `activity_log`, and uploaded files (copy them to the Storage buckets).

## Security notes

- Helmet headers, a CORS allow-list, request size limits and rate limits are on by default.
- Staff are checked on every request; roles are enforced here **and** by row-level security in the database.
- Logs are JSON with a request id. Donor PAN, phone and e-mail are never written to the logs.
- The service-role key bypasses row-level security: it must exist only in Secret Manager and in this service.

## Branches and contributing

| Branch                                | Purpose                                                                |
| ------------------------------------- | ---------------------------------------------------------------------- |
| `main`                                | Production. Cloud Build deploys it to the production Cloud Run service |
| `stage`                               | Staging. Deploys to the staging service                                |
| `dev`                                 | Integration. Runs the checks only                                      |
| `<name>-dev` (for example `kaif-dev`) | Personal working branch                                                |

Work on your own branch, open a pull request into `dev`, then promote `dev` → `stage` → `main` by pull request. Do not commit directly to `main` or `stage`. Payment and receipt logic must come with tests. A change that needs a new table or column goes into `sjks-database` first.

## License

Private repository. All rights reserved by Sahara Jan Kalyan Samiti.
