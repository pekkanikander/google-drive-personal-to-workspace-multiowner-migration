# Architecture Spike 4 (Sheets-backed manifest + per-user log)

Dry-run SPA that:
- Authenticates via GIS token client (same OAuth client ID as spike 2).
- Reads the shared manifest sheet (`Sheet1`) in spreadsheet `1bE37jbEhI6CUD_uiW0Bc25T3G9fk3SxJJg6jvpl8lcw`.
- Filters rows where `owners` contains the signed-in user.
- Claims small batches by setting `status=STARTED` and `worker_session_id=<session>`, simulates work with a delay, then sets `status=DONE`.
- Appends coarse log entries to `Log`.
- Buffers status/log writes in IndexedDB and flushes every ~2s via Sheets batchUpdate/append. No retries/backoff beyond the timer; fails fast on sheet shape mismatch.

## Setup

1) Install deps (once):
```sh
cd spike-4
npm install
```

2) Build:
```sh
npm run build
```

3) Serve `public/` on an authorised origin for the GIS OAuth client (same as spike 2, e.g. `http://localhost:8081`):
```sh
cd public
python3 -m http.server 8081
```

4) Open the page, authenticate, then **Load manifest + start**. Use two different Google accounts in two browser windows for concurrency observation. The app intentionally waits ~1.5s between claim/complete to make overlap visible.

If the sheet is missing expected columns/sheets, the app stops immediately (no backoff/recovery).
