# Architecture spike 4: Sheets-backed manifest + per-user logging (SPA-only)

## Purpose

Mitigate risk R4 by validating Google Sheets as the manifest/progress store for the SPA-only model. This spike exercises manifest reading and coarse-grained status/log writes from **two concurrent user SPAs**, using minimal IndexedDB buffering and batched Sheets writes. No file moves/copies occur; this is a dry run of the future user SPA behaviour.

## Questions this spike must answer

1. Can two user SPAs concurrently read a shared manifest (in Sheets) and append coarse progress to a log sheet without clobbering each other?
2. Does a simple IndexedDB-backed local journal survive tab reloads and let a user resume flushing pending writes?
3. Is batching (e.g. ~2s flush) sufficient to stay within Sheets per-user write quotas in this scenario?
4. Are `worker_session_id` markers enough to avoid obvious stale/duplicate status updates for the same user rows?
5. Is the manifest format usable/readable for admins, and does it stay stable during user writes?

## In scope

- Use an existing Sheet (e.g. the one created from Spike 3) as the manifest; add columns manually if needed.
- The existing sheet file has, at `Sheet1`, the following columns: `id`, `name`, `mimeType`,	`parents`, `owners`, `driveId`, `trashed`, `shortcut_target_id`, 	`shortcut_target_mimeType`, `permissions`, `createdTime`, `modifiedTime``
  - The Spike added manually the `status` and `worker_session_id` to `Sheet1`.
  - The Spike added manually another empty sheet, `Log`.
- User SPA-only client that:
  - Reads manifest rows for the signed-in user, i.e. `owners` includes the signed-in user.
  - Claims a small batch (e.g. 5 rows) by updating `status` and `worker_session_id` in `Sheet1` in one batch.
  - Simulates work (no Drive actions), then marks completion in one batch.
  - Appends coarse log entries (claim + complete) to `Log` using `spreadsheets.values.append`.
- Minimal IndexedDB journal to persist pending status/log updates until a flush succeeds; flushed to the sheet via a simple timer (~2s).
  - If continuing the work requires a write (i.e. claiming rows), wait.
- Run two browser windows (two users) concurrently against the same spreadsheet to observe interactions.

## Out of scope

- Actual Drive copy/move operations.
- Any backend/service accounts; everything runs in-browser.
- Retry backoff sophistication or retries.
- All cross-device continuation.

## Assumptions

- Sheets API is enabled on the OAuth project.
- Humans do **not** sort/filter/edit while SPAs run.
- Rows are pre-partitioned by user, i.e. `owners` (each SPA only touches its own rows).
  - Any multi-owner rows are not processed, only an error is logged.
- Coarse status transitions only: `<none> → STARTED → DONE` (or `FAILED`), no mid-flight granular updates.
- Trashed items may remain in the manifest; users simply skip anything not assigned to them.

## Minimal design

- **Manifest sheet** (admin-prepared): Use the existing sheet as a "fake" manifest. Immutable during the spike.
- **Status `Sheet1` sheet**: one row per task. SPA updates only rows where `owners` include `signed-in user`. Fields updated: `status`, `worker_session_id`.
- **Log sheet**: append-only; low frequency (claim + completion only).
- **Batching**: accumulate status updates locally and flush via `spreadsheets.values.batchUpdate` no more often than every ~2 seconds. Logs appended via `values.append` in the same flush cycle, if present.
- **Local durability**: pending updates stored in IndexedDB before scheduling a flush; cleared after successful batch and flush.
- **Staleness guard**: when claiming, write a new `worker_session_id`; if a row is already `STARTED` with a different session ID, leave it untouched.

## Success criteria

1. Two user sessions can claim and complete their own rows without overwriting each other.
2. Pending updates survive an SPA tab reload and flush successfully afterward.
3. Write volume stays low (on the order of a handful of requests per flush, well under Sheets’ per-user quota in this test).

## Test procedure (suggested), to be performed by the developer

1. Prepare the spreadsheet (reuse Spike 3 output):
   - Verify Status (Sheet1) and Log sheets.
2. Open the user SPA in two browsers profiles; sign in as two distinct accounts.
3. For each user:
   - Load manifest rows, claim tasks, simulate work (e.g. 1–2s delay), complete tasks.
   - Trigger a tab reload mid-run to verify pending flush survives.
4. Observe sheets:
   - Status rows move <none> → STARTED → DONE with correct `worker_session_id`.
   - Log sheet shows claim/complete events.
5. Confirm no cross-user row overwrites and no quota errors.

## Deliverables

- A simple SPA page (as `spike-4/`) implementing the above flow.
- README notes on setup, required Sheet columns, and how to run two users concurrently.
- Lessons learned added to the docs upon completion (esp. any quota/staleness observations).
