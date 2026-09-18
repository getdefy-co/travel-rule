<p align="center">
  <a href="https://getdefy.co/">
    <img alt="Defy" src="./docs/assets/defy-logo.png" width="160">
  </a>
</p>

<h1 align="center">Defy Travel Rule</h1>

<p align="center">
  An open-source, self-hosted Travel Rule Protocol (TRP) 3.2.1 node and operator interface from <a href="https://getdefy.co/">Defy</a>.
</p>

<p align="center">
  <a href="./LICENSE"><img alt="Apache License 2.0" src="https://img.shields.io/badge/license-Apache--2.0-2563eb"></a>
  <a href="./docs/api/trp-api.md"><img alt="TRP 3.2.1" src="https://img.shields.io/badge/TRP-3.2.1-0ea5e9"></a>
  <a href="./package.json"><img alt="Node.js 24" src="https://img.shields.io/badge/Node.js-24-339933?logo=nodedotjs&logoColor=white"></a>
  <a href="./docs/docker-deployment.md"><img alt="Docker Compose" src="https://img.shields.io/badge/Docker-Compose-2496ed?logo=docker&logoColor=white"></a>
</p>

<p align="center">
  <a href="https://getdefy.co/">Website</a> ·
  <a href="./ARCHITECTURE.md">Architecture</a> ·
  <a href="./CONTRIBUTING.md">Contributing</a> ·
  <a href="./SUPPORT.md">Support</a>
</p>

> **Private pre-release:** Defy licenses this repository's original work under Apache License 2.0. Keep the repository private until the unresolved `ivms101@2.0.0` licensing evidence in [Third-Party Notices](./THIRD_PARTY_NOTICES) and the remaining public-release gates are resolved. This repository and its images are not approved for public redistribution.

Defy Travel Rule helps virtual asset service providers exchange IVMS101 identity data, apply Türkiye and European Union policy profiles, review compliance cases, and deliver signed webhooks. It never holds assets or broadcasts blockchain transactions.

<p align="center">
  <img alt="Defy Travel Rule dashboard showing transfer activity, protocol outcomes, and delivery health" src="./docs/assets/defy-travel-rule-dashboard.png" width="1200">
</p>
<p align="center"><sub>Dashboard shown with synthetic demonstration data.</sub></p>

## Why Defy Travel Rule

- **Native TRP interoperability:** Exchange inquiries, resolutions, and confirmations over TRP 3.2.1
- **Policy-aware orchestration:** Evaluate versioned `TR-MASAK-2025` and `EU-TFR-2024` profiles before protocol delivery
- **Operator workflows:** Review transfers, inquiries, messages, tokens, events, and compliance cases in the authenticated interface
- **Durable delivery:** Persist protocol attempts, retries, dead-letter states, audit history, and signed webhook delivery
- **Secure boundaries:** Separate browser, internal API, PostgreSQL, and external mutual TLS (mTLS) surfaces
- **Self-hosted control:** Run the complete stack with Docker Compose and keep regulated data in your environment

## Start with Docker

The supported host is Ubuntu 24.04. Docker Compose starts PostgreSQL 17, the Express 5 backend, the Next.js 16 frontend, Nginx, runtime-secret bootstrap, and local-admin bootstrap.

### Prerequisites

- Ubuntu 24.04
- Docker Engine 27 or newer with the Docker Compose plugin
- At least 4 GB of available memory
- `curl` for readiness checks

Authorized collaborators can clone the private pre-release repository with their configured GitHub credentials:

<!-- command-acceptance: non-ci:private-clone -->
```bash
git clone https://github.com/getdefy-co/travel-rule.git
cd travel-rule
```

Start the complete local stack:

<!-- command-acceptance: ci:docker:stack-start -->
```bash
docker compose up --build --wait
```

Open [http://localhost:3000](http://localhost:3000) and sign in:

| Field | Fresh local installation |
| --- | --- |
| Email | `admin@getdefy.co` |
| Password | `defyadmin` |

These credentials are development fixtures. Never reuse them in production. Bootstrap creates this account only when it is absent and never resets its password. Bootstrap fails closed if this email belongs to an inactive account or a role other than `admin`.

Confirm readiness, inspect the stack, and stop it without deleting persistent data:

<!-- command-acceptance: ci:docker:stack-lifecycle -->
```bash
curl --fail --silent --show-error http://localhost:3000/login >/dev/null
docker compose ps
docker compose down
```

Delete local development data only when you need a fresh installation:

<!-- command-acceptance: ci:docker:cleanup -->
```bash
docker compose down --volumes
```

This command permanently removes the Compose project's local PostgreSQL data and generated secrets.

## Architecture at a glance

Defy isolates browser traffic, partner protocol traffic, application internals, and persistent data:

```mermaid
flowchart LR
  Browser["Operator browser"] -->|"127.0.0.1:3000"| Gateway["Nginx gateway"]
  Gateway --> Frontend["Next.js UI"]
  Gateway --> Backend["Express backend"]
  Peer["VASP peer"] -->|"TLS 1.3 and mTLS<br/>0.0.0.0:3001"| Backend
  Backend -->|"internal data network"| Database["PostgreSQL 17"]
```

| Address | Exposure | Purpose |
| --- | --- | --- |
| `http://localhost:3000` | Host loopback only | UI, same-origin Auth, case review, inquiry review, and approved management paths |
| `https://localhost:3001` | All host interfaces | TLS 1.3 identity, health, and mTLS TRP protocol allowlist |
| `backend:3002` | Docker networks only | Complete internal Auth, orchestration, management, and TRP APIs |
| `postgres:5432` | Internal Docker data network only | PostgreSQL persistence |

The backend supports scoped compliance roles plus legacy `admin` and `user` compatibility roles. Read [Architecture](./ARCHITECTURE.md) for listener, persistence, encryption, authentication, and delivery details.

## Production boundaries

The default administrator, synthetic VASP identity, generated certificate authority, and generated client certificate exist for local development only. A production deployment must supply managed secrets, production public key infrastructure, reviewed identity values, backups, monitoring, rotation procedures, and network controls.

This release supports fresh installations. It does not perform runtime database migrations or in-place schema upgrades. Email delivery is disabled by default, so password recovery and Travel Rule email invitations require an external SMTP configuration.

Read [Docker Deployment](./docs/docker-deployment.md), [Backup, Restore, and Key Rotation](./docs/operations/backup-restore-key-rotation.md), and [Troubleshooting](./docs/troubleshooting.md) before evaluating a non-local deployment.

## Development and verification

Use Node.js 24 and npm 11 or newer. Install the three independent dependency graphs:

<!-- command-acceptance: ci:quality -->
```bash
npm ci
npm ci --prefix backend
npm ci --prefix frontend
```

Run the repository checks:

<!-- command-acceptance: ci:quality -->
```bash
npm run verify
npm run verify:docs
npm --prefix frontend run build
```

Run the Ubuntu Docker acceptance suite after Docker, runtime, network, or orchestration changes:

<!-- command-acceptance: ci:docker:full -->
```bash
npm run test:docker:smoke
```

The TRP end-to-end suite requires an isolated PostgreSQL database and OpenSSL:

<!-- command-acceptance: ci:e2e -->
```bash
DATABASE_URL='postgres://user:password@127.0.0.1:5432/isolated_test_database' npm --prefix backend run test:e2e
```

Never point the end-to-end suite at production or shared data.

## Documentation

- [Architecture](./ARCHITECTURE.md)
- [Auth API](./docs/api/auth-api.md)
- [Compliance Orchestration API](./docs/api/orchestration-api.md)
- [TRP API](./docs/api/trp-api.md)
- [Postman Collection](./docs/postman/README.md)
- [Manual TRP Testing](./docs/manual-trp-testing.md)
- [Docker Deployment](./docs/docker-deployment.md)
- [Backup, Restore, and Key Rotation](./docs/operations/backup-restore-key-rotation.md)
- [Troubleshooting](./docs/troubleshooting.md)
- [Changelog](./CHANGELOG.md)

## Support and security

Email [info@getdefy.co](mailto:info@getdefy.co) when you need help with setup or usage. You can also use the repository's [issue forms](https://github.com/getdefy-co/travel-rule/issues/new/choose) for reproducible bugs and scoped feature requests.

Do not send passwords, tokens, private keys, personal data, database dumps, or vulnerability evidence to the general support address. Follow the private reporting process in [Security Policy](./SECURITY.md) for suspected vulnerabilities.

Community support has no guaranteed response time and does not provide legal, compliance, production operations, or incident-response advice. Read [Support](./SUPPORT.md) for the full support boundaries.

## Contributing

Contributions are welcome during the private pre-release phase. Read [Contributing](./CONTRIBUTING.md), follow the [Code of Conduct](./CODE_OF_CONDUCT.md), and preserve the documented security and protocol boundaries.

## License and project status

Defy licenses the repository's original code and documentation under the [Apache License 2.0](./LICENSE). Review [NOTICE](./NOTICE), [Third-Party Notices](./THIRD_PARTY_NOTICES), and [Trademarks](./TRADEMARKS) before redistribution.

The `ivms101@2.0.0` evidence remains unresolved. Do not publish the repository, packages, or container images until maintainers close every public-release gate.
