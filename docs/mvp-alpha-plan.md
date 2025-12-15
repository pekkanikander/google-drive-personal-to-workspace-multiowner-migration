# MVP / Alpha Plan (move-only, SPA-only)

Purpose: lock the alpha scope, surface explicit constraints, and define the minimal manifest/state model so admin/user SPAs stay consistent.

## Scope and constraints (alpha)

- Move-only; no copy or move+restore variants.
- Two SPAs, static hosting; no backend/service account required for user flow.
- Sheets-backed coordination (manifest + status/log). Fail fast on schema mismatches; no retries/backoff beyond coarse batching.
- Temporary manual Shared Drive Manager grants per participating user; admins revoke after completion.
- Single-device resume only; cross-device continuation is out of scope.
- Humans must not edit/sort/filter the manifest while SPAs run.

Deferred post-alpha: copy modes, retry/backoff for Sheets writes, cross-device resume, narrower ACLs (per-user subfolders or service-account automation), backend orchestration, advanced reporting.

## Roles and responsibilities

- **Admin SPA (manual steps):**
  - Uses GIS token client (Drive/Sheets scopes).
  - Shared source root is granted Viewer; destination Shared Drive is granted Manager.
  - Enumerates source tree; writes manifest sheet into a destination folder (same Shared Drive).
  - Distributes user SPA link; grants temporary Manager to participating users; revokes after completion.
  - Observes progress via Sheets status/logs (no live dashboard beyond Sheets).
- **User SPA:**
  - Uses GIS token client (Drive/Sheets scopes).
  - Reads manifest sheet; filters rows by `owners` containing the signed-in user.
  - Claims small batches (status/worker_session_id), performs move (future alpha impl), logs coarse events.
  - Resumes only on the same device via local journal; no cross-device support.

## Manifest schema (Sheet: `Sheet1`)

Columns (header row, fixed order; uppercase here for clarity):
- `id` (source file/folder ID)
- `name`
- `mimeType`
- `parents` (semicolon-separated IDs)
- `owners` (semicolon-separated emails; multi-owner rows are skipped by user SPA)
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
- Admin writes all columns except `status`, `worker_session_id`, `error`.
- User SPA writes only `status`, `worker_session_id`, and optionally `error`.
- Multi-owner rows are left untouched in alpha; logged as skipped.
- No rows are added/deleted while runs are active; row order must remain stable.

## Log sheet (`Log`)

Append-only; columns:
- `timestamp` (ISO8601)
- `event` (`CLAIM`, `COMPLETE`, `SKIP_MULTI_OWNER`, `FAIL`, etc.)
- `user_email`
- `row_index` (1-based as in Sheet1)
- `file_id`
- `session_id`
- `details` (optional message)

Low frequency: claim + completion per batch, plus skips/failures.

## State model (SPAs)

- **Session ID:** random per load; stored in memory and used to mark claimed rows (`worker_session_id`).
- **Local journal (IndexedDB):** queued status updates and log entries written before scheduling a flush; cleared after successful flush.
- **Flush cadence:** ~2s batching for status and logs; no exponential backoff. Transient errors surface as “fail fast” and require manual retry.
- **Stale detection:** user SPA only touches rows with `status` empty or `STARTED` with same `worker_session_id`; `STARTED` with a different session is left untouched (manual intervention if needed).
- **Crash/reload:** on reload, journal is re-flushed; manifest reloaded; only same-device continuation is supported.

## Admin runbook (alpha)

1) Configure GIS OAuth client (web) with allowed origins; enable Drive + Sheets APIs.
2) Share source root to admin as Viewer; share destination Shared Drive to admin as Manager.
3) Run Admin SPA to enumerate and write manifest sheet in destination folder; ensure schema matches above.
4) Grant temporary Manager to participating users on the destination Shared Drive.
5) Share user SPA link; users authenticate and run.
6) Monitor `Sheet1` and `Log`; when a user’s rows are `DONE`, revoke their Manager role (manual).
7) After all rows `DONE`, archive manifest/logs; keep a copy of the destination folder mapping.

## Open items to revisit post-alpha

- Add retries/backoff for Sheets writes and clearer error surfacing in UI.
- Expand transfer modes (copy, move+restore) and validate Forms/response Sheets edge cases.
- Narrow destination ACLs (per-user folders) or service-account-managed grants/revokes.
- Cross-device continuation and more robust stale-claim recovery.
- Optional backend for aggregation/monitoring and reduced Sheets write volume.
