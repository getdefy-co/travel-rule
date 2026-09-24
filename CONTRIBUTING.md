# Contributing to Defy Travel Rule

Thank you for helping improve Defy Travel Rule. Contributions must preserve its security boundaries, TRP 3.2.1 interoperability, IVMS101 handling, and operator documentation.

## Before contributing

- Read [Architecture](./ARCHITECTURE.md), [Repository Guidelines](./AGENTS.md), and the affected API contract.
- Use [GitHub issue forms](https://github.com/getdefy-co/travel-rule/issues/new/choose) for confirmed bugs or scoped feature proposals.
- Follow the private pre-release reporting lifecycle in [Security Policy](./SECURITY.md). Only authorized collaborators currently have a maintainer-approved private repository route; external reporting must not be advertised until GitHub private vulnerability reporting is enabled and verified.
- Keep the repository private and do not publish artifacts while the `ivms101@2.0.0` license gate in [Third-Party Notices](./THIRD_PARTY_NOTICES) remains unresolved.

By participating, you agree to follow the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Development environment

Use Node.js 24, npm 11+, and Ubuntu 24.04 Docker for acceptance. Install each independent dependency graph:

```bash
npm ci
npm ci --prefix backend
npm ci --prefix frontend
```

Start the local full stack:

```bash
docker compose up --build --wait
```

The local UI/auth URL is `http://localhost:3000`; external TRP is `https://localhost:3001`; internal API is `backend:3002`; PostgreSQL is internal at `postgres:5432`. Local-only credentials are documented in [README](./README.md).

## Change design

Keep patches cohesive and reviewable. Preserve public methods, paths, status codes, response fields, rate limits, roles (`admin` and `user`), persistence semantics, and trust boundaries unless a breaking change is explicitly approved.

Before adding a production dependency, confirm that Node.js or an existing package cannot provide the capability. Include license evidence, dependency-tree/audit results, and SBOM impact. Do not introduce any dependency whose redistribution terms are unclear.

Database changes require an update to the fresh-install schema and its canonical bootstrap validation. Runtime migrations and in-place upgrades are out of scope for this release; startup must never mutate initialized databases. A restore requires the exact repository revision and verified SHA-256 of that revision's canonical `database.sql`; a changed release requires a new fresh installation.

## Tests and documentation

Use test-driven development for behavior changes and repository validators. Add a failing regression test first, observe the expected failure, then implement the smallest fix.

Every `frontend/src/**/*.js|jsx` file has exactly one mirrored test under `frontend/__tests__/`. Keep user-visible frontend text in the i18n catalogs.

Run focused checks, then:

```bash
npm run verify
npm --prefix frontend run build
npm --prefix backend ls --omit=dev
npm --prefix frontend ls --omit=dev
npm --prefix backend audit --omit=dev
npm --prefix frontend audit --omit=dev
```

For TRP changes, use an isolated PostgreSQL database and OpenSSL:

```bash
DATABASE_URL='postgres://user:password@127.0.0.1:5432/isolated_test_database' npm --prefix backend run test:e2e
```

For Docker/runtime changes:

```bash
npm run test:docker:smoke
```

Update README, architecture, API, environment, fresh-install schema, deployment, and troubleshooting documents whenever their contracts change. `npm run verify:docs` checks links, anchors, env parity, terminology, Action pinning, shell syntax, direct dependency notices, and that every README/manual shell block is linked to an operation actually invoked by Ubuntu CI or one of the narrowly permitted non-CI reasons.

## Pull requests

- Use a focused branch and Conventional Commit messages.
- Complete the pull-request template with risk, fresh-install schema, security, and verification evidence.
- Do not include `.env`, private keys, generated certificates, runtime volumes, dumps, logs, uploads, caches, build output, or SBOM artifacts.
- Keep generated `backend/dist/` and frontend `.next/` output out of commits.
- Resolve review findings with evidence; never weaken a test, lint rule, authentication guard, or security header merely to make a check pass.

Maintainers may request changes, close stale/out-of-scope proposals, or defer a contribution until the public-release gate is resolved.

## Licensing contributions

Unless you explicitly state otherwise, an intentional contribution submitted for inclusion is provided under Apache License 2.0, consistent with section 5 of the project [LICENSE](./LICENSE). You must have the right to submit the contribution and must identify third-party code or assets and their applicable terms.
