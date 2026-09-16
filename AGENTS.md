# Repository Guidelines

This file is the repository-level working agreement. It applies to both applications. Read the relevant application section before editing.

## Canonical Sources

- [`README.md`](./README.md): setup, commands, layout, and documentation index
- [`ARCHITECTURE.md`](./ARCHITECTURE.md): cross-application runtime, persistence, and security design
- [`docs/api/auth-api.md`](./docs/api/auth-api.md) and [`docs/api/trp-api.md`](./docs/api/trp-api.md): public API contracts
- [`backend/package.json`](./backend/package.json), [`frontend/package.json`](./frontend/package.json), and their lockfiles: application scripts and dependency truth
- [`backend/.env.example`](./backend/.env.example) and [`frontend/.env.example`](./frontend/.env.example): canonical variable names

Verify current behavior in source and tests. Keep every affected canonical document synchronized with implementation.

## Working Sequence

1. Inspect Git status and preserve unrelated changes.
2. Read the relevant source, tests, configuration, and canonical documentation.
3. Identify public contract, authentication, persistence, operational, and documentation impact.
4. Implement the smallest coherent change using existing patterns.
5. Review the diff for dead code, stale artifacts, secrets, and accidental edits.
6. Run focused tests first, then the relevant application and root checks.
7. Report behavior, documentation impact, observed checks, and material remaining risk.

Do not commit, push, deploy, publish, call a state-changing external service, or alter live data unless explicitly requested.

## Repository Commands

```bash
npm ci
npm ci --prefix backend
npm ci --prefix frontend
npm run verify
npm run verify:docs
npm run update:docs-acceptance-lock
npm run verify:docker:static
npm run test:docker:smoke
npm run verify:backend
npm run verify:frontend
npm run hooks:precommit
```

When an acceptance shell fence in `README.md` or `docs/manual-trp-testing.md`, or any source in `scripts/docker-smoke.sh`, changes intentionally, regenerate `scripts/docs-acceptance-lock.json` with `npm run update:docs-acceptance-lock` and review the manifest diff. Validation is read-only and never updates the lock automatically.

Use Node.js 24 and npm 11+. PostgreSQL is the backend's only stateful runtime dependency. The Ubuntu 24.04 Docker contract publishes only loopback UI/auth `127.0.0.1:3000` and external TRP `0.0.0.0:3001`; `backend:3002` and `postgres:5432` remain internal.

## Shared Security and Data Rules

- Treat external input as untrusted and validate it at system boundaries.
- Never expose or commit secrets. Use the existing environment files and variable names.
- Preserve public methods, paths, auth tiers, validation, response fields, status codes, pagination, and rate limits unless a breaking change is explicit.
- Use parameterized SQL for dynamic values and sanitize errors before persistence or responses.
- Do not modify `.env`, logs, uploads, production resources, or shared data without explicit approval.
- Consider authentication, authorization, XSS, injection, SSRF, path traversal, races, replay, and secret leakage where relevant.

## Backend Guidelines

The backend is an Express 5 Auth API with an optional TRP 3.2.1 node. Auth and health are always mounted; `/identity` and `/travel-rule/trp/*` exist only for exact `PROTOCOL=TRP`. Do not add another protocol, worker, alternate pool, blockchain broadcaster, or unrelated integration unless explicitly requested.

Allowed aliases are `@controllers`, `@database`, `@json`, `@libs`, `@requests`, and `@routers`.

- Follow Airbnb Base and backend Prettier: two spaces, single quotes, semicolons, and trailing commas.
- Every arrow function under `backend/src/` uses a block body and explicit `return` when producing a value; test callbacks are exempt.
- Keep routes in routers, validation and guards in controllers, use cases in request handlers, adapters in libs, Auth SQL in `backend/src/database/auth.js`, and error persistence in `backend/src/database/error.js`.
- Prefer async/await and existing sanitized response/logging conventions.
- Do not manually edit generated `backend/dist/`.

Backend public and security contracts:

- Protected handlers require a valid JWT and active user. Management endpoints additionally require exact `admin`.
- Supported roles are `admin` and `user`; do not reintroduce `super_admin` compatibility.
- TRP orchestration uses the `X-API-Key`-only, constant-time, generic-401 service guard.
- Inquiry review and decisions require an active JWT but deliberately do not require `admin`.
- Update [`docs/api/auth-api.md`](./docs/api/auth-api.md) or [`docs/api/trp-api.md`](./docs/api/trp-api.md) for every affected public contract.

`backend/src/schemas/database.sql` is the sole fresh-install schema. Docker bootstrap validates its canonical metadata before creating the local administrator and fails closed for an incompatible initialized volume. Production upgrades and migrations are out of scope for this release; never execute destructive, shared, or production database changes without explicit approval, a verified backup, and a restore rehearsal.

For backend changes, run focused Jest suites followed by `npm --prefix backend run verify`. Run `npm --prefix backend run test:e2e` for TRP behavior only when an isolated test database and OpenSSL are available. Run `npm --prefix backend ls --omit=dev` and audit when dependencies change.

## Frontend Guidelines

The frontend is a Next.js 16 App Router UI with public `/login`, authenticated `/`, and exact-`admin` `/users` application routes. `frontend/src/app/layout.jsx` composes Theme, i18n, Auth, and toast providers. Do not reintroduce removed product domains without an approved architecture change.

- Use `.jsx` for React components and `.js` for non-component modules.
- Use the `@/` alias for `frontend/src` imports.
- Keep two-space indentation and nearby quote/semicolon conventions.
- Use Tailwind utilities and retained shadcn primitives. Preserve public exports of retained shared modules.
- Put every user-visible string in the active react-i18next catalogs: `common`, `auth`, `modals`, `enums`, or `errors`.
- Keep browser-side Defy API calls in `frontend/src/lib/api.jsx`.
- Browser Auth and exact-admin user management use same-origin `/auth/*` and `/auth/manage/*`; do not add a build-time public API base URL.
- `authToken` is the only application-owned authentication persistence key. Never store secrets in browser storage.

Every `frontend/src/**/*.js|jsx` file requires exactly one mirrored test under `frontend/__tests__/`. Keep assertions focused on observable behavior and accessibility. Read `frontend/AGENTS.md` for the Next.js version-specific generated guidance before editing frontend code. Run focused tests followed by `npm --prefix frontend run verify` and `npm --prefix frontend run build` for implementation work.

## Dependencies and Generated Files

- Do not add a dependency when Node.js or an existing dependency already provides the capability.
- Keep backend and frontend dependency graphs and lockfiles independent.
- Do not edit lockfiles or generated output manually when npm or the owning build tool can regenerate them.
- Keep `LICENSE`, `NOTICE`, `THIRD_PARTY_NOTICES`, community files, package metadata, and documentation links synchronized. The repository remains private while the `ivms101@2.0.0` license evidence is unresolved.
- When dependencies change, run the relevant `npm ls` and `npm audit` commands and report observed results.

## Handoff

Report:

1. Concise result summary
2. Changed files and important decisions
3. Commands, tests, builds, and checks actually run with outcomes
4. Material remaining risks or operational follow-up
