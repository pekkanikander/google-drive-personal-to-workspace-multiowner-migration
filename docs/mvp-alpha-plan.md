# MVP / Alpha Plan (move-only, SPA-only)

Purpose: lock the alpha scope, surface explicit constraints, and define the minimal manifest/state model so admin/user SPAs stay consistent.

## Scope and constraints (alpha)

- Move-only; copy and move+restore variants are postponed to a later version.
- Two SPAs, static hosting; no backend/service account required for user flow.
- Google Sheets-backed coordination (manifest + status/log).
  - Fail fast on schema mismatches
  - No API retries/backoff beyond coarse batching.
- Temporary manual Shared Drive Manager grants per participating user
  - Admin grants manually before starting.
  - If feasible, the admin SPA checks that the grants are there.
  - Admin revokes manually after completion.
- Single-device SPA resume only; cross-device SPA continuation is out of scope.
- Humans must not edit/sort/filter the manifest while SPAs run.

Deferred post-alpha: copy modes, API retry/backoff for Sheets writes, cross-device SPA resume,
narrower ACLs (per-user subfolders or service-account automation),
automated used authorisation (if possible), backend-assisted orchestration,
more robust manifest design, advanced reporting.

## Roles and responsibilities

- **Admin SPA (manual steps):**
  - Uses GIS token client (Drive/Sheets scopes).
  - Shared source root is granted Viewer; destination Shared Drive is granted Manager.
  - Enumerates source tree; writes manifest sheet into a destination folder (same Shared Drive).
  - Distributes user SPA link; checks temporary Manager role of the participating users.
  - Observes progress via Sheets status/logs (no live dashboard beyond Sheets).
- **User SPA:**
  - Uses GIS token client (Drive/Sheets scopes).
  - Reads manifest sheet; filters rows by `owners` containing the signed-in user.
  - Claims small batches (status/worker_session_id), performs move, logs coarse events.
  - Resumes only on the same device via browser local journal; no cross-device support.

## Google sheet design

### `JobInfo` sheet (gid=0)

Key/value metadata (two columns: `key`, `value`). Canonical keys for alpha:
- `job_id` — random token chosen by admin SPA (for rotation/obscurity).
- `job_label` — human label to display to users.
- `transfer_mode` — `move` (alpha only).
- `manifest_version` — e.g. `v1`.
- `dest_drive_id` — Shared Drive ID.
- `dest_root_id` — root folder ID within the destination Shared Drive for this job.
- `manifest_sheet_name` — fixed to `Manifest`.
- `log_sheet_name` — fixed to `Log`.

### Manifest schema (Sheet: `Manifest`)

Columns (header row, fixed order; uppercase here for clarity):
- `id` (source file/folder ID)
- `name`
- `mimeType`
- `parents` (semicolon-separated IDs)
- `owners` (semicolon-separated emails; multi-owner rows are skipped by the user SPA)
- `driveId`
- `trashed` (`true`/`false`)
- `shortcut_target_id`
- `shortcut_target_mimeType`
- `permissions` (JSON string, optional)
- `createdTime`
- `modifiedTime`
- `dest_parent_id` (destination parent in Shared Drive; required for move)
- `dest_drive_id` (destination drive ID; optional if implied by parent)
- `status` (empty | `STARTED` | `DONE` | `FAILED` (optional))
- `worker_session_id` (string; used for stale detection/reclaim)
- `error` (optional human-readable note on failure)

Rules:
- Admin SPA writes all columns except `status`, `worker_session_id`, `error`.
- User SPA writes only `status`, `worker_session_id`, and optionally `error`.
- Multi-owner rows and shortcuts are left untouched in alpha; logged as skipped.
- No rows are added/deleted while runs are active; row order must remain stable.

### Log sheet (`Log`)

Append-only; columns:
- `timestamp` (ISO8601)
- `event` (`CLAIM`, `COMPLETE`, `SKIP_MULTI_OWNER`, `FAIL`, etc.)
- `user_email`
- `row_index` (1-based as in Manifest)
- `file_id`
- `session_id`
- `details` (optional message)

Low frequency: claim + completion per batch, plus skips/failures.

## State model (SPAs)

- **Session ID:** random per load; stored in memory and used to mark claimed rows (`worker_session_id`).
- **Local journal (IndexedDB):** queued status updates and log entries written before scheduling a flush to the Google sheet; cleared after successful flush to the sheet.
- **Flush cadence:** ~2s batching for status and logs; no exponential backoff. Transient errors surface as “fail fast” and will require manual retry / resolution by the admin.
- **Stale detection:** user SPA only touches rows with `status` empty or `STARTED` with same `worker_session_id`; `STARTED` with a different session is left untouched (requiring manual intervention by the admin, if needed).
- **Crash/reload:** if the tab closes, pending queued status/log writes in the local journal are flushed on next load (same device), then the manifest is reloaded. Rows already marked `STARTED` by another session stay untouched; only this device resumes work.
- **Claimed-but-unfinished rows:** rows left in `STARTED` with this session’s `worker_session_id` remain eligible for this device after reload. Other sessions skip them. Manual recovery (alpha): if a session never returns, the admin/user can clear `status`/`worker_session_id` in the sheet to requeue. Automated timeouts/reclaims are post-alpha.
- **Move execution (idempotency):** before a move, fetch live parents; if already under the destination drive/parent, treat as done. Otherwise, `PATCH files/{id}` with `supportsAllDrives=true`, `addParents=<dest_parent_id>`, `removeParents=<current parents from the fresh GET>`. Retries repeat the check+patch, avoiding duplicates. Copy-mode idempotency is deferred post-alpha (requires tracking destination IDs).

## User SPA link design (pre-OAuth)

- Link content is non-secret; real guards are Drive/Sheets ACLs and post-OAuth email verification against the manifest.
- Include: sheet ID (plain text), and a random job token for obscurity/rotation. Tab names are fixed (`JobInfo`, `Manifest`, `Log`), so they are not passed in the link.
- Keep sensitive data out of the link (no per-user emails, no credentials). Destination IDs live in the manifest rows (`dest_parent_id`, `dest_drive_id`).
- Prefer placing parameters in the URL fragment (`#...`) to avoid referrer leakage.
- On load: obtain token/sheet from link, run OAuth, fetch job info, then manifest, validate schema, and confirm signed-in email appears in the manifest before proceeding.

## Error handling and recovery (alpha)

- **Write failures / quota errors:** surfaced in the UI as “fail fast”;
  recorded as errors to the manifest and log, with the SPA stopping.
  The users/admins must refresh and retry after a pause. No automatic backoff in alpha.
- **Tab close/crash:** on reload (same device), the user SPA shall first load the local journal and the manifest.
  If the local journal contains any non-flushed items, the user SPA shall determine any files moves that may
  not have taken place. With this info, the user SPA shall first flush the current job status to the manifest and
  log, also logging the close/crash.  After that, the user SPA starts "mid-flight" of the batch,
  retrying with the moves apparently not performed.  If feasible, the actual move API calls are framed idempotent
  so that retrying them doesn't matter, simplifying the logic.
  Only rows `STARTED` with this session ID are resumed; other sessions’ `STARTED` rows are skipped.
  The admin SPA does not need a local journal.
- **Stuck `STARTED` rows (other sessions):** manual recovery in alpha is for the admin to manually clear the `status`/`worker_session_id` in the sheet to requeue. Automated timeouts/reclaims are deferred.
- **Consistency guard:** SPAs only write `status`, `worker_session_id`, and optionally `error`; any schema mismatch causes a fast failure.
- **No cross-device resume:** continuation relies on the same device’s local journal; other devices will not reclaim another session’s rows.

## Admin runbook (alpha)

1) Manually configure GIS OAuth client (web) with allowed origins; enable Drive + Sheets APIs.
2) Manually share source root to admin as Viewer; share destination Shared Drive to admin as Manager.
3) Grant temporary Manager to participating users on the destination Shared Drive.
4) Run Admin SPA to enumerate and write manifest sheet in destination folder; ensure schema matches above.
5) Manually share user SPA link; users authenticate and run.
6) Monitor `Manifest` and `Log`; when a user’s rows are `DONE`, revoke their Manager role manually.
7) After all rows `DONE`, archive manifest/logs; keep a copy of the destination folder mapping.

## Open items to revisit post-alpha

- Add retries/backoff for Sheets writes and clearer error surfacing in UI.
- Expand transfer modes (copy, move+restore) and validate Forms/response Sheets edge cases.
- Narrow destination ACLs (per-user folders) or service-account-managed grants/revokes.
- Cross-device continuation and more robust stale-claim recovery.
- Optional backend for aggregation/monitoring and reduced Sheets write volume.
