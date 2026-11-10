# Monoprix Online

Monoprix Online is a demonstration e-commerce platform for supermarket shopping in Sierra Leone. This project uses a monorepo structure with a React + Vite frontend and an Express + Prisma backend. It is designed as a polished concept demo with clearly labelled sample data.

## Stack

- Frontend: React, TypeScript, Vite, Tailwind CSS, React Router, TanStack Query, Zustand, React Hook Form, Zod
- Backend: Node.js, Express, TypeScript, Prisma, Supabase PostgreSQL
- Auth: secure HTTP-only cookies with JWT and bcrypt password hashing
- Demo commerce: product catalog, shopping cart, checkout, order tracking, admin dashboard

## Quick start

1. npm install
2. npm run build
3. npm run dev

The web app runs on http://localhost:5173, the API runs on http://localhost:4000.

## Database setup

The API uses Supabase PostgreSQL. Set these values in `apps/api/.env`:

- `DATABASE_URL`: Supabase Transaction Pooler URI (port 6543) for application traffic, with `pgbouncer=true` and `sslmode=require`.
- `DIRECT_URL`: Supabase direct connection URI (port 5432), or Session Pooler URI on port 5432, for Prisma migrations, with `sslmode=require`.

Apply committed migrations with `npm run prisma:migrate:deploy --workspace @monoprix/api`. Check migration state with `npm run prisma:migrate:status --workspace @monoprix/api`. Do not use `prisma migrate dev` against a production database. The legacy SQLite migration history is retained separately and is not used by the PostgreSQL datasource.

The demo seed is create-only: it does not delete or update existing rows. It is still restricted to a local database whose name contains `dev`, `test`, or `local`, requires `ALLOW_DEMO_SEED=true`, a unique `DEMO_SEED_PASSWORD` of at least 12 characters, and the explicit `--confirm-demo-seed` argument. Never enable it in production.

Example, only for an explicitly disposable local development database:

`npm run prisma:seed --workspace @monoprix/api -- --confirm-demo-seed`

The script refuses `NODE_ENV=production` and any non-local or non-development database target.

## Monime hosted checkout

The API supports test-mode Monime hosted checkout in SLE. Add these values to `apps/api/.env`:

- `MONIME_ACCESS_TOKEN`: a test-mode token beginning with `mon_test_` (the legacy `MONIME_ACCESS_KEY` name is temporarily accepted).
- `MONIME_SPACE_ID`: the Monime Space used for checkout.
- `MONIME_WEBHOOK_SECRET`: the separate signing secret configured for Monime webhooks; this is not the API token.
- `API_PUBLIC_URL`: the externally reachable API origin for Monime's success callback.
- `ENABLE_MOCK_PAYMENTS=true`: optional local/test-only mock flows; mocks are disabled in production.

The integration rejects non-test Monime tokens. Hosted checkout exposes payment methods enabled for the merchant's Monime account. Orange Money and Visa/Mastercard were confirmed enabled for the merchant's **test-mode** account; live eligibility must be confirmed separately before any live-payment change. Configure Monime to send checkout-session events to `/api/v1/payments/webhooks/monime`.

The checkout-session database migration is committed but not applied automatically. Generate the Prisma client after pulling the change with `npm run prisma:generate --workspace @monoprix/api`. Review and apply migrations only to the intended database with `npm run prisma:migrate:deploy --workspace @monoprix/api`; do not point this at production without explicit approval.

## Production hardening and test status

See [PRODUCTION-READINESS.md](./PRODUCTION-READINESS.md) for implemented safeguards, executed checks, and outstanding blockers. API tests and builds are local checks; they do not prove live Supabase connectivity, migrations, Cloudinary uploads, or browser workflows.

Database integration and browser tests require dedicated `TEST_DATABASE_URL` and `TEST_DIRECT_URL` values targeting an isolated `marketplace_test` schema. Set them in `apps/api/.env`, along with an isolated staff account (`E2E_STAFF_EMAIL` and `E2E_STAFF_PASSWORD`). The explicit test-migration command requires `CONFIRM_TEST_MIGRATION=true`; review and approve the target before running it. It is not safe to substitute production URLs.

## Notes

- All products, prices, and orders are sample demonstration data.
- Cash-on-delivery and Monime test-mode hosted checkout are supported. Real refunds are not implemented.
- Product imagery is generated locally for the demo catalogue and tracked in docs/image-sourcing.md.
