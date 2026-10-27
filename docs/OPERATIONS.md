# Classence operations and security

Classence is a localhost-only prototype. Run MySQL and the Node backend on `127.0.0.1`; use the Faculty site through the configured local Live Server origin and load the Student folder as an unpacked Chrome extension. Public hosting, Cloudflare Tunnel, reverse proxies, and cross-computer access are unsupported.

## Configuration and database

Keep `backend/.env` private. Copy `backend/.env.example` for a new installation, configure local MySQL credentials, then run `npm.cmd run db:migrate` and `npm.cmd run db:verify` from `backend`. Never edit migrations that may already be applied, reset production-like records, or delete migration markers to retry a failed migration.

## Security and privacy

The backend accepts only approved local origins, uses parameterized MySQL queries, validates request shapes, limits abusive requests, and verifies account role, class ownership, enrollment, consent, and session state. Monitoring is restricted to the designated Google Meet tab and a fresh report is not proof of call membership, physical activity, or attendance.

Students can withdraw monitoring consent. Finalized attendance, audit history, monitoring history, and privacy requests are protected from routine cleanup. Any retention policy or institutional privacy procedure must be approved before enabling deletion.

## Backup and recovery

`scripts/backup/backup.cjs` supports encrypted backups and restore verification only with operator-supplied private credentials, encryption key, and external destination. Restore is restricted to a new disposable database. Do not place backups, dumps, credentials, or keys in the repository.

## Verification

Use the focused commands in the root README. Generated test reports are intentionally ignored by Git. Browser and Chrome-extension tests require local Chrome; a test that was not run is not evidence that the associated feature works.
