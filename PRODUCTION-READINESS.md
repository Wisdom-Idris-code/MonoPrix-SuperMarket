# Production readiness and security hardening

## Summary

The current changes add safeguards and test harnesses, but this application is **not yet verified or ready for production deployment**. No live Supabase writes, migrations, Cloudinary uploads, or browser end-to-end tests have been run. Existing production data was not reset, deleted, seeded, or modified as part of this work.

## Implemented and locally verified

- **Demo seed protection:** removed delete operations; inserts skip existing records. Seeding fails in production and requires explicit opt-in, a local development/test database name and host, a strong seed password, and a CLI confirmation flag.
- **Image upload validation:** API limits uploads to one JPEG, PNG, or WebP image up to 10 MiB, checks declared MIME type against file signatures, restricts upload folders, and proxies signed uploads through the server. API tests cover MIME/signature checks, oversize rejection, and authorization. A real Cloudinary request was not made.
- **Role permissions:** STAFF and ADMIN permissions are enforced on API routes. Staff can manage products, images, orders, and inventory, but cannot archive/restore products, manage categories or accounts, cancel orders, read audit logs, or authorize refunds. Order status choices follow the approved workflow; inventory, order, product, category, user, image, and refund operations are audited. Staff order lists do not include payment records or payloads. Admin refund authorization only records an authorization event; it does not transfer money. Integration credentials remain deployment-environment configuration; the application does not currently provide a settings-management endpoint.
- **Authentication hardening:** password minimum is 12 characters, passwords use bcrypt, the cookie is HttpOnly/SameSite=Lax, the default token/cookie lifetime is 24 hours (configurable from 1 to 168 hours), inactive accounts are rejected, and unsafe cross-origin state-changing requests are blocked.
- **Isolated test harnesses:** database tests require explicit test URLs and guard against the production schema. The migration runner requires a separate confirmation and rejects migrations containing selected destructive SQL operations. Integration fixtures are transactionally rolled back; browser fixtures are create-only and are not cleaned up.
- **Dependency update:** upgraded Zod to v4.6.7. The API build, web build, and API test suite passed after the upgrade.

## Verification actually performed

| Check | Result |
|---|---|
| API TypeScript build | Passed |
| Web TypeScript/Vite production build | Passed |
| API automated tests | Passed: 19 tests, including role-permission matrix, role denials, and database target safety |
| Prisma schema validation | Passed using placeholder connection URLs; no database connection was made |
| Production dependency audit (`npm audit --omit=dev`) | Passed: 0 reported vulnerabilities |
| Full dependency audit | Not clean: one moderate and one high finding in the Vite/esbuild development-server dependency chain; automatic remediation requires a major Vite upgrade |
| Supabase connectivity, migration, CRUD, transaction, inventory reservation | Not run |
| Playwright browser E2E | Not run |
| Real Cloudinary upload | Not run |

The API tests use stubs and an in-process HTTP server. They do not prove live database, payment, email, or Cloudinary behavior.

## Deployment blockers and remaining risks

1. **Pending additive database migration:** `User.isActive` is now part of the Prisma schema and auth queries. The migration adds this column with a default of `true`, but has not been applied to any database. Deploying the API before approving and applying this migration will cause auth queries to fail against the existing schema.
2. **Isolated integration/E2E database unavailable:** configure `TEST_DATABASE_URL` and `TEST_DIRECT_URL` for an isolated `marketplace_test` schema, then explicitly approve its creation/migration before running the live tests. These credentials must stay in the local environment file and must not be pasted into chat. Do not point test commands at the production schema.
3. **E2E credentials and browser run:** configure `E2E_STAFF_EMAIL` and `E2E_STAFF_PASSWORD` for a dedicated STAFF account in the isolated test database. Then run the guarded Playwright workflow; it creates test users/orders and does not clean them up.
4. **Development tooling advisory:** the complete dependency audit flags Vite/esbuild. Production-only dependencies currently audit clean, but do not expose the Vite development server to untrusted networks. Plan a compatible Vite toolchain update and rerun the full audit/builds.
5. **Rate limiting is process-local:** configured API/auth limits use in-memory state. Multi-instance production requires a shared rate-limit store and proxy/IP configuration review.
6. **Payments/refunds:** no online payment provider or real refund integration exists. Refund authorization is an audited administrative record only.
7. **Additional production operations:** configure and verify email delivery, backups/restore procedures, monitoring/alerting, secrets rotation, and production deployment/migration rollback procedures before launch.

## Recommended next steps

1. Review the additive `User.isActive` migration and approve a staged deployment plan.
2. Provision and verify the isolated test schema without using the production schema; then explicitly approve its migration.
3. Run the guarded integration suite and Playwright suite against that test schema and report their actual results.
4. Select and test a compatible Vite/esbuild update; do not use `npm audit fix --force` without validating the breaking toolchain change.
5. Complete payment, shared rate-limit storage, operational readiness, and external-service verification before production launch.
