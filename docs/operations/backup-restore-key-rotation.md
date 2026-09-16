# Backup, Restore, and Key Rotation Runbook

## Scope and approval

This runbook covers backup, restore, encryption-key rotation, incidents, and delivery-queue recovery. Defy is fresh-install-only: it has no runtime migration or in-place schema-upgrade procedure. Every backup, restore, or key-rotation activity requires an approved change, a named operator, a separately authorized destination, and a recorded recovery objective.

The local Compose stack is a development and acceptance fixture. Its generated CA, administrator, PostgreSQL credential, JWT key, service API key, and data-encryption key are not production material.

## Backup set

A recoverable backup consists of:

1. A PostgreSQL physical backup with WAL archive for point-in-time recovery, or a version-compatible custom-format `pg_dump` for a smaller pilot deployment.
2. The active and retired data-encryption keyring, identified by key ID.
3. JWT and OIDC configuration, scoped API-client operational records, webhook signing arrangements, and SMTP configuration.
4. TRP server/client private keys, certificate chains, peer trust bundles, and the configured VASP identity.
5. The exact application image digests, repository revision, Compose/override configuration, and SHA-256 of that revision's canonical `backend/src/schemas/database.sql`.

Database dumps contain encrypted PII but remain sensitive. Encrypt every backup before it leaves the database host with the VASP’s approved KMS/HSM or backup product, use a backup-specific key that is not stored beside the archive, enforce least-privilege access, and record retention/deletion evidence. Do not place dumps, WAL, keyring files, or private keys in this repository or application logs.

## Backup procedure

1. Confirm the target environment, PostgreSQL major version, current image digests, exact repository revision, canonical `database.sql` SHA-256, backup destination, encryption policy, retention profile, and available free space.
2. Record the active `TRP_DATA_ENCRYPTION_ACTIVE_KEY_ID` and the state of any `encryption_reencryption_jobs`. Do not retire a key while a job is running or failed.
3. Verify PostgreSQL readiness and backup-system health. For physical backup/PITR, confirm WAL archiving is current. For a logical pilot backup, use `pg_dump --format=custom` against the approved database role and capture stderr without echoing the connection string.
4. Encrypt the archive immediately using the approved external backup boundary. Compute and store a cryptographic checksum outside the archive.
5. Back up the keyring and PKI through their owning secret manager. Keep database backup and decryption authority separated.
6. Verify archive readability, checksum, encryption metadata, expected table inventory, and retention policy. A command exit code alone is not backup evidence.
7. Record start/end time, backup identifier, database version, image revision, repository revision, canonical `database.sql` SHA-256, archive checksum, encryption key reference, and verification result in the operator change record.

## Restore rehearsal

Perform rehearsals on an isolated network and a newly created database/secret namespace. Never point a rehearsal at shared or production data.

1. Provision the same PostgreSQL major version and sufficient storage. Check out the exact repository revision recorded with the backup and verify the recorded SHA-256 of its canonical `backend/src/schemas/database.sql`. Deny external protocol traffic, outbound webhooks, SMTP, and connector delivery.
2. Restore the physical backup and required WAL to the chosen recovery point, or restore the custom-format dump into an empty database.
3. Mount a copied recovery keyring and PKI with least privilege. Do not reuse the rehearsal copies after the exercise.
4. Start the application with delivery egress still blocked. Startup must validate the restored database against that revision's canonical schema before listeners open.
5. Verify `/health/ready`, API-client credential metadata, queue/dead-letter counts, and the latest transfer/case/exchange totals. Do not reveal credentials or decrypted PII in the evidence record.
6. Sample compliance audit exports and require `integrity: valid`. Prove records encrypted under both active and retired key IDs can be read.
7. Exercise a non-delivering transfer/case workflow with test identities, then validate backup recovery point and measured RTO/RPO against the approved objective.
8. Destroy the isolated rehearsal database and copied secrets through the organization’s approved disposal process. Retain only redacted evidence and measurements.

## Fresh-install release boundary

Restoration is supported only at the exact repository revision and canonical `database.sql` SHA-256 recorded with the backup. Do not attach an initialized database to a changed release or attempt to alter it in place. A changed release requires a new fresh installation; moving existing data to that installation is outside this release's supported runtime procedures and requires separately approved data-transfer design, validation, backup, and restore rehearsal.

## Data-encryption key rotation

1. Generate a new independent 32-byte key in the approved secret manager and assign a unique safe key ID.
2. Before changing the active key, preserve the current explicit `TRP_DATA_ENCRYPTION_LEGACY_KEY_ID`. If it is unset and therefore defaults to the pre-rotation active key ID, set that ID explicitly before switching the active key. Do not repoint the legacy key ID on later rotations: version-1 envelopes can be decrypted only with the key it identifies. Change or retire it only after version-1 inventory confirms no such envelopes remain, re-encryption is complete, and the backup/restore verification gate has passed.
3. Mount the new key as active and keep the old key in the retired-key set. Preserve every existing retired key; do not replace or delete keys during rotation.
4. Restart one backend and prove old and new envelopes are readable. New writes now use version 2 with the active `key_id`.
5. As `admin` or `platform_admin`, create one re-encryption job targeting the active key ID. Monitor it to `completed`; a failed job retains a stable error code and requires investigation before retry planning.
6. Verify representative reads and audit exports, then take a new encrypted backup.
7. Retire the old key only after database inventory, restore rehearsal, retention/legal requirements, and every backup still needing that key have been independently verified.

Deleting an old key before those gates is irreversible data loss. Re-encryption is resumable and concurrency-safe, but it does not make old backups readable with the new key.

## Incident and failure handling

- Canonical schema validation failure: stop startup or recovery, compare the restored database, exact repository revision, and recorded `database.sql` SHA-256. Do not alter catalog metadata, force startup, or attach the volume to a changed release.
- Restore verification failure: preserve logs and database state, keep ingress closed, inspect backup integrity, PostgreSQL-version compatibility, capacity, and the exact-revision/schema-digest record. Retry only after the cause is understood.
- Re-encryption failure: retain all active/retired keys, inspect the stable job state and sanitized application logs, and restore only from verified backup when data corruption is confirmed.
- Audit integrity failure: freeze the affected evidence export, preserve database/WAL/log evidence, and invoke the VASP incident process.
- Queue growth or dead letters: keep custody release decisions conservative, inspect connector/certificate/network health, and do not manually mark delivery successful.
