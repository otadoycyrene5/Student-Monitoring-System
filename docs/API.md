# Classence API reference

All application endpoints are served beneath `/api`. The backend is localhost-only and requires the configured Faculty origin or approved Chrome extension origin.

## Authentication

`POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`, and `GET /api/auth/me` manage accounts and sessions. Faculty browser sessions use protected cookies; Student extension requests use the authenticated extension flow. The caller can update only their own allowed profile fields.

## Classes, sessions and attendance

Authenticated routes beneath `/api/auth/live` provide class creation, editing, enrollment, joining/leaving sessions, session start/end, attendance records, attendance correction/finalization, and Faculty session lists. Faculty ownership and active enrollment are verified server-side for every request.

Attendance is calculated from the first valid session join. Meet activity and tab-switch counts are monitoring metadata; neither changes attendance automatically.

## Monitoring

`/api/auth/monitoring/start`, `/state`, `/event`, and `/stop` require an enrolled, joined Student and explicit consent. Events contain only the designated Meet tab state, event identity, sequence, and observation time. Unrelated tabs, page content, titles, keystrokes, media, and browsing history are not accepted or stored.

## Privacy

`/api/auth/privacy` routes provide the notice, acknowledgement, authenticated data export, and privacy-request workflow. Requests do not automatically alter attendance, monitoring consent, or academic records.

## Errors

Responses use `{ success, data }` on success or `{ success: false, message }` on failure. Validation, authentication, authorization, rate limiting, and origin checks are enforced by the backend; clients must not infer authorization from UI state.
