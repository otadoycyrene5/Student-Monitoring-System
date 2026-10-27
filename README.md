# Classence - Online Student Activity Monitoring

## 1. Project overview

Classence is a localhost-only academic prototype. A Faculty Website and Student Chrome Extension connect to a Node.js backend and MySQL on the same computer. It is not intended for public deployment or remote classroom access.

Faculty manage classes, sessions and attendance. Students enroll, participate, and explicitly consent to limited Google Meet tab observations. Tab selection does not prove call membership, attention or attendance.

## 2. Technology stack

HTML, CSS, JavaScript, Chrome Manifest V3, Node.js 22+, Express 5, Socket.IO, MySQL 8, mysql2, Argon2, dotenv, CORS, Helmet and express-rate-limit. Nodemon supports development. Dependency versions are recorded in `backend/package-lock.json`.

## 3. Folder structure

```text
backend/
  config/          Privacy settings
  database/        Setup, unchanged migrations and integrity verification
  docs/            Concise API and operations references
  scripts/         Local backup and privacy-retention tools
  src/             Express, Socket.IO, services, middleware and configuration
  tests/           Local API, browser, database and recovery suites
  package.json, package-lock.json, .env.example
frontend/
  teacher/         Faculty HTML, styles, scripts and assets
  student/         MV3 manifest, popup, styles and background worker
  tests/           Current browser interfaces, registration and manifest checks
README.md
```

The two browser apps contain their own presentation helpers and Socket.IO assets for independent loading. No frontend npm installation is required. Third-party licenses are retained.

## 4. Requirements

Use Windows with PowerShell, Node.js 22 or newer with npm, MySQL 8, Chrome 120 or newer, and VS Code with Live Server.

Run the backend, Faculty Website, Student Extension and MySQL on the same computer:

| Component | Address |
| --- | --- |
| Backend | `http://127.0.0.1:3000` |
| Faculty via Live Server | `http://127.0.0.1:5500/frontend/teacher/` |
| MySQL | `127.0.0.1:3306` |
| Student Extension API | `http://127.0.0.1:3000` |

`localhost:5500` is also allowed for Live Server. Installing the extension on another computer does not connect it to this computer. Google Meet itself still requires the student's normal internet connection; Classence services remain local.

## 5. MySQL database setup

Start the installed MySQL service. In MySQL Workbench, connect as an authorized administrator and run [create_database.sql](backend/database/setup/create_database.sql) if the database is missing.

For a new dedicated application account, substitute a password you choose locally:

```sql
CREATE USER IF NOT EXISTS 'classence_app'@'127.0.0.1'
  IDENTIFIED BY '<YOUR_LOCAL_PASSWORD>';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES, TRIGGER
  ON classence_db.* TO 'classence_app'@'127.0.0.1';
```

Use the account/host matching your MySQL installation. An existing account retains its password. Keep actual credentials private. MySQL binary logging can require DBA configuration for trigger creation; an `ER_BINLOG_CREATE_ROUTINE_NEED_SUPER` error requires administrator review, not changes to migration SQL.

## 6. Backend installation and configuration

Open the project root in VS Code. In PowerShell:

```powershell
cd backend
npm.cmd install
if (-not (Test-Path -LiteralPath .env)) {
    Copy-Item -LiteralPath .env.example -Destination .env
}
```

Edit `backend/.env`. Use `NODE_ENV=development`, `PORT=3000`, `DB_HOST=127.0.0.1`, `DB_PORT=3306`, your dedicated `DB_USER`/`DB_PASSWORD`, and the existing database name (`classence_db` by default). Keep existing account credentials and records when updating an installed project.

The configured `CLIENT_ORIGIN` should be:

```text
http://localhost:5500,http://127.0.0.1:5500,chrome-extension://jefdcdmlgafknafmpdondeglcbimdnki
```

Only explicit local HTTP origins and the approved extension origin are accepted. If Live Server selects another port, configure that exact local origin and restart the backend. The backend always binds to `127.0.0.1` and ignores proxy forwarding for trust decisions. Public hostnames and production mode are unsupported.

On a new database, or when applying reviewed pending migrations, run from `backend`:

```powershell
npm.cmd run db:migrate
npm.cmd run test:integrity
```

Never edit applied migrations, reset existing tables or delete recovery markers to force a retry. See the [operations guide](backend/docs/OPERATIONS.md) for recovery boundaries. Eight tracked migrations define the current schema.

## 7. Starting the backend

From `backend`:

```powershell
npm.cmd start
```

Keep the terminal open. Alternatively, `npm.cmd run dev` uses Nodemon. In another PowerShell terminal:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/health
Invoke-RestMethod http://127.0.0.1:3000/api/health/ready
```

Both should succeed. Readiness checks database/schema prerequisites. Stop the backend with Ctrl+C. No tunnel, public domain, reverse proxy or hosting service is required.

## 8. Running the Faculty Website

1. Keep MySQL and the backend running.
2. Open the repository root in VS Code and install Live Server if necessary.
3. Right-click `frontend/teacher/index.html` and choose **Open with Live Server**.
4. Open `http://127.0.0.1:5500/frontend/teacher/` at the default port.
5. Register or log in with a Faculty account.

Use HTTP through Live Server, rather than opening HTML with `file://`. Keep the hostname consistent: `localhost` and `127.0.0.1` are different origins. The Express backend serves the API only; it does not host the Faculty HTML.

## 9. Installing the Student Chrome Extension

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode** and choose **Load unpacked**.
3. Select `frontend/student`, the folder containing `manifest.json`.
4. Confirm **Classence Student** loads without errors and has ID `jefdcdmlgafknafmpdondeglcbimdnki`.
5. Pin the extension, open its 400px popup, and register or log in.

Reload the extension after source changes. Its popup is `index.html` and its Manifest V3 worker is `js/background.js`. The source folder is used directly; there is no deployment build step. An HTTP preview does not replace the installed worker.

## 10. Testing the main features

1. Faculty creates a class with a standard Google Meet link and shares its class code.
2. Student enrolls using that code.
3. Faculty starts a session; Student joins it in Classence.
4. Student reads the notice and explicitly chooses **I Agree - Start Monitoring**.
5. Review permitted tab observations on Live Monitoring. Closing/reopening the popup should preserve valid participation and consent.
6. Student uses **Stop Monitoring** to withdraw consent while staying joined, or leaves the session to stop participation and monitoring.
7. Faculty ends the session. Attendance is calculated from the backend first join: less than 15 minutes is Present; 15 minutes or more is Late; never joined by session end is Absent. Session end saves and finalizes automatically. Historical finalized records are preserved; corrections require reopening with a reason.
8. Verify Faculty/Student profiles and Student privacy access/export/requests.

Run applicable automated tests from `backend`:

```powershell
npm.cmd run test:cleanup
```

Focused checks:

```powershell
npm.cmd run test:attendance:auto
npm.cmd run test:auth
npm.cmd run test:student
npm.cmd run test:monitoring:worker
npm.cmd run test:security
npm.cmd run test:privacy
npm.cmd run test:integrity
node tests/local-config.cjs
node tests/step8-frontend.cjs faculty-overview.cjs
node tests/step8-frontend.cjs student-interface.cjs
node ../frontend/tests/student-package.cjs
```

Browser tests launch isolated Chrome profiles with synthetic accounts in rollback fixtures. They verify original record counts, although AUTO_INCREMENT counters can advance. Backup/operations tests use separate disposable databases and need MySQL command-line tools and sufficient local privileges. Generated JSON reports are ignored by Git. A failed or crashed Chrome run is not a pass.

## 11. Scope and limitations

- Academic prototype for one local hosting computer; no public or cross-computer operation is supported.
- Chrome-only extension; startup requires the local MySQL service and correct credentials.
- No screenshots, keystrokes, unrelated browsing history, page contents, audio or video are collected by monitoring.
- Popup closure does not withdraw consent. Network/worker interruptions can produce unknown or stale reports; missing reports are not automatic absence.
- Attendance uses recorded session joins independently of monitoring observations. Automatic changes are audited; finalized history is protected. Backend startup reconciles unfinalized completed attendance with audit snapshots; already finalized history is never recalculated.
- Meet activity is Active while the registered Meet tab is selected in the focused window, On Another Tab while unfocused, and Inactive after five continuous minutes supported by fresh reports. Stale, missing, stopped or withdrawn monitoring is Unknown and breaks the timer. These labels describe Meet tab focus, not attention, physical activity or call membership.
- Institutional privacy policy and retention/request procedures still need approval. Privacy requests do not automatically erase data or change academic records.
- The default privacy notice now describes local-only storage/operation under a new notice version. Existing acknowledgement history is preserved; acknowledgement and session monitoring consent remain separate.
- Current disposable-database backup/readiness tests can fail with `ER_BINLOG_CREATE_ROUTINE_NEED_SUPER` until a DBA reviews MySQL trigger authorization under binary logging.
- `.env`, installed dependencies, private backups and generated reports are gitignored. Review the actual files/index/history before publishing source; no upload is performed by setup.
