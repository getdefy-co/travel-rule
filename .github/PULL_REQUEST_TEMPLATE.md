# Pull request

## Summary

Describe the outcome and why this change is needed.

## Contract and risk

- Public API/status/response impact:
- Authentication/authorization/session impact:
- Persistence/fresh-install schema/restore impact:
- Docker/network/secret/certificate impact:
- TRP 3.2.1/IVMS101 interoperability impact:

## Verification

List commands actually run and observed outcomes. Do not mark unavailable checks as passed.

- [ ] Focused regression tests
- [ ] `npm run verify`
- [ ] `npm --prefix frontend run build`
- [ ] Relevant `npm ls --omit=dev` and `npm audit --omit=dev`
- [ ] Isolated backend e2e when TRP behavior changes
- [ ] `npm run test:docker:smoke` when runtime/Docker behavior changes
- [ ] Documentation/env/API/fresh-install schema contracts updated

## Security and release gates

- [ ] No secrets, personal data, dumps, logs, generated certificates, build output, or SBOM artifacts are committed.
- [ ] New/changed dependencies include license evidence and an explained need.
- [ ] The unresolved `ivms101@2.0.0` public-release gate is not represented as closed.
- [ ] This change does not make the repository or artifacts public.
