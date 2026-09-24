# Security Policy

## Supported versions

Defy Travel Rule has not made a public release. Security fixes are accepted only against the current private `main` branch.

| Version | Supported |
| --- | --- |
| Private `main` | Yes |
| Historical commits, forks, and unapproved images | No |

The repository must remain private until the `ivms101@2.0.0` licensing gate, secret scan, Ubuntu Docker acceptance, dependency review, CodeQL, and documentation gates are closed.

The current private phase does not have an authorized GitHub Code Security/GHAS entitlement, so the workflow visibility guard skips CodeQL. That skipped job is not a passing release gate. CodeQL must run with normal Code Scanning upload after a separately approved public visibility change, or through an explicitly enabled and licensed private GitHub Code Security path.

## Reporting a vulnerability

Do not open an issue, discussion, pull request, or social-media post for a suspected vulnerability.

During the current private pre-release phase, only authorized collaborators can report through a maintainer-approved private repository channel to which they already have access. A draft repository security advisory may be used only when maintainers have enabled it and the collaborator has permission; otherwise the collaborator must obtain the private route from a maintainer without placing details in a repository issue.

There is no supported external reporter intake while the repository remains private. Before any public visibility change, maintainers must enable and verify GitHub private vulnerability reporting, then make the future [private vulnerability report form](https://github.com/getdefy-co/travel-rule/security/advisories/new) available. Repository visibility must not change until that release gate is proven.

Include only the minimum evidence needed to reproduce safely:

- Affected commit and component
- Preconditions and threat model
- Reproduction steps or proof of concept with synthetic data
- Observed and expected behavior
- Security impact and suggested remediation, if known

Do not include production secrets, personal data, live Travel Addresses, JWTs, API keys, certificates' private keys, database dumps, or active exploit traffic. Redact tokens and use an isolated environment.

For reports accepted through an available approved channel, maintainers will acknowledge as repository access and availability permit, validate impact, coordinate a fix and tests, and agree on disclosure timing. No response-time or bounty commitment is currently offered.

## Scope priorities

High-priority areas include authentication/authorization, JWT revocation, reset-token replay, mTLS and TLS validation, service API-key isolation, CORS/proxy trust, SSRF/DNS rebinding, SQL injection, XSS/token theft, secret/PII logging, encryption key handling, Docker host exposure, bootstrap races, and canonical-schema integrity.

The local administrator, generated CA/client certificate, and synthetic VASP identity are documented development fixtures. Their existence is not itself a vulnerability unless they become reachable or reused outside the stated local boundary.

## Disclosure and releases

Security advisories remain private until a fix, regression tests, affected-version analysis, and disclosure plan are ready. Do not publish an image, package, advisory, or repository visibility change without explicit maintainer approval and all release gates satisfied.
