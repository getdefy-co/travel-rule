# Changelog

All notable changes to this project are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions will follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) after the first release.

## Unreleased

### Added

- Ubuntu 24.04 Docker Compose runtime for PostgreSQL 17, Express, Next.js standalone, and Nginx.
- Dual backend listeners: internal HTTP on `backend:3002` and external TLS 1.3/mTLS TRP on port 3001.
- Atomic development secret/certificate bootstrap and idempotent local administrator bootstrap.
- Default local-only administrator `admin@getdefy.co` / `defyadmin`.
- Database-aware readiness, PostgreSQL timeouts, graceful shutdown, same-origin gateway, and Docker/Playwright acceptance.
- Apache-2.0 project licensing, community health files, security policy, third-party notices, CI, CodeQL, secret scanning, SBOM, and documentation validation.

### Changed

- Auth failures and forgot-password acknowledgement resist user enumeration.
- Local administrator bootstrap preserves an active legacy `admin@defy.local` account instead of creating a second default administrator.
- Passwords enforce an 8–72 UTF-8-byte boundary.
- JWTs carry `session_version`; password, role, and activity changes revoke older sessions.
- Reset tokens are stored as SHA-256 digests and Auth multi-step writes are transactional.
- Logs and persisted error/audit data recursively redact secrets and personal/request data.
- Frontend Auth calls use same-origin `/auth/*` with a 30-second timeout and only `admin`/`user` roles.
- Documentation now describes TRP 3.2.1, IVMS101, ports 3000/3001/3002/5432, fresh-install-only Docker bootstrap, and local versus production boundaries.
- CodeQL skips the unlicensed private-repository phase and performs normal Code Scanning upload only when repository visibility is public.

### Security

- External port 3001 uses an exact method/path allowlist and hides Auth, JWT, and API-key surfaces behind 404.
- TLS, secret, database, SMTP, CORS, and listener configuration fail fast.
- Public release remains blocked pending authoritative `ivms101@2.0.0` licensing evidence plus green security/Docker/documentation gates.
