# Error Recovery Plan (Alpha -> Later)

This document defines the recovery strategy for the two-SPA migration workflow.
It is intended to be self-contained so it can be used as the implementation plan
for resiliency improvements.

Scope:
- Alpha: move-only, Sheets-backed manifest/log, no backend.
- Later: copy and move+restore copy, with provenance tags.

## Goals

- Resume after network errors or transient API failures.
- Resume after the user closes the tab or the browser crashes.
- Avoid duplicate moves or copies.
- Keep write volume within Sheets API limits.

Non-goals for alpha:
- Perfect multi-tab coordination.
- Cross-device continuation without manual recovery.
- Automatic resolution of concurrent sessions beyond basic safeguards.
These all may come later, depending on their implementation complexity,
and are therefore good to keep in mind.

## Recovery Mechanisms

### 1) Idempotent moves

Previously started but non-completed file moves can be retried safely:
1) GET the file, by its ID, to read current parents.
2) If the destination parent is already present, treat as DONE.
3) Otherwise PATCH with addParents + removeParents using the fresh parents list.

This makes moves safe to retry after crashes, timeouts, or lost responses.

### 2) Copy provenance via appProperties (post-alpha)

Copies are not idempotent by default. To recover from a lost request/response,
the copy operation shall include provenance metadata so it can be found later:

- In files.copy, include appProperties, such as:
  - migration_job_id
  - migration_source_id
  - migration_mode (optional)

If the client crashes after a copy is created but before recording the new file ID of the copy,
the recovery logic can query for an existing copy by appProperties.
If such a copy is found, the copy operation may be considered done (and logged so).
If there is still other operations pending for the file, as there may be in some future modes,
handling the file can continue with such next step(s).

### 3) Manifest + Log as the source of truth

The manifest holds per-file state; the log provides coarse audit events.
For alpha, recovery can rely on the manifest alone (moves are idempotent).
The log is useful for operator visibility and future automation.
In alpha, the recovery logic does not need to consult the log.

### 4) Local journal (optional optimization)

A local SPA-level journal is not required for correctness in move-only mode.

Such a journal improves UX, by:
- Persisting the session_id across reloads (same browser).
- Using pending journal entries as hints, then verifying Drive state before writing status/log updates.

## Recovery Model and Batch Algorithm

Definitions:
- A "session" is a run of the User SPA identified by session_id.
- A "batch" is a small group of manifest rows claimed together.
- Manifest status values: "" (empty), STARTED, DONE, FAILED, IGNORED.

### Batch recovery algorithm (move-only)

Given a candidate batch of rows of files owned by the current user:

1) Determine whether each row is eligible to process:
   - DONE: skip.
   - IGNORED: skip.
   - STARTED with current session_id: eligible to resume.
   - STARTED with different session_id: skip or reclaim per policy (see below).
   - "" or FAILED: eligible.

2) For each eligible row:
   - GET file metadata to read current parents.
   - If destination parent is already present, mark DONE and log COMPLETE.
   - Else PATCH move (addParents, removeParents) and mark DONE on success.
   - On error, mark FAILED and log FAIL.

3) Write status updates in Sheets batchUpdate.
4) Append log rows in Sheets values.append with coarse events:
   CLAIM, COMPLETE, FAIL, IGNORED.

### Batch recovery algorithm (copy or move+restore copy)

Use the same eligibility logic as move-only, but for each row:

1) Query copy destination folder for a file whose appProperties match:
   - migration_job_id = job_id
   - migration_source_id = source_id
2) If found:
   - Record dest_file_id in the manifest and mark DONE (or restore step if needed).
3) If not found:
   - Execute files.copy with appProperties.
   - Record dest_file_id in the manifest and mark DONE.

Move+restore copy performs:
1) Move (idempotent, as above).
2) Copy back to the source parent with appProperties for restore_copy_id.

### Stale session policy (alpha)

Without explicit timestamps, "foreign STARTED" (different session_id) rows are treated as blocked.
Manual recovery: admin (or user) clears status/worker_session_id to requeue.

Optional future policy (post-alpha):
- Add a started_at column or use log timestamps to auto-reclaim after a timeout.

## Manifest and Log (current alpha)

Manifest columns (alpha schema):
- id
- name
- mimeType
- parents
- owners
- driveId
- trashed
- shortcut_target_id
- shortcut_target_mimeType
- permissions
- createdTime
- modifiedTime
- dest_parent_id
- dest_drive_id
- status ("" | STARTED | DONE | FAILED | IGNORED)
- worker_session_id
- error

Log columns (alpha schema):
- timestamp (ISO8601)
- event (CLAIM, COMPLETE, FAIL, IGNORED)
- user_email
- row_index
- file_id
- session_id
- details

Notes:
- Multi-owner rows are left untouched in alpha.
- Multi-parent rows and shortcuts are marked IGNORED with a reason in error.
- Status updates and logs are batched to stay within Sheets rate limits.

## Implementation Stages

Stage 0 (docs only)
- Align docs with current behavior.

Stage 1 (move-only, no journal)
- Ensure session_id is stable per run (no reload support yet).
- Respect blocked STARTED rows from other sessions.
- Idempotent move logic in place (GET parents -> PATCH).
- Log CLAIM/COMPLETE/FAIL/IGNORED.

Stage 2 (move-only, minimal journal)
- Persist session_id in IndexedDB and reuse it on reload.
- Persist pending status/log intents;
  - on reload, verify Drive state for those rows, before writing updates to Sheets.
  - write Sheets only at the end of the batch, as usual. No extra logic needed for Sheets update here.
- Resume STARTED rows for the same session without admin intervention.
  - use persisted status (from before crash) as hint, if feasible

Stage 3 (copy modes with provenance)
- Add appProperties tags on copies.
- Add manifest fields for dest_file_id and restore_copy_id.
- Add recovery query to detect existing copies by appProperties.

Stage 4 (stale session reclaim)
- Add started_at to manifest or use log timestamps.
- Auto-reclaim STARTED rows after timeout (TBD).

Stages 0–2 are for alpha.  Stages 3 and 4 are post-alpha.

## Potential questions and answers.

1) Q: Should we add started_at (or last_claimed_at) to the manifest to enable
   automatic reclaim, or keep manual recovery in alpha?

   A: Keep manual recovery for alpha.  Return to the issue on post alpha; decide the exact details only then.

2) Q: Do we want to persist session_id in IndexedDB in alpha, or keep it for post-alpha?

   A: Persist session_id in IndexedDB in alpha, at Stage 2.

3) Q: For copy modes, should appProperties keys be standardized now
   (migration_job_id, migration_source_id), or deferred until copy is implemented?

   A: The current suggestions in this file are sufficient for now.
      Their exact values can be defined when the copying is implemented.
