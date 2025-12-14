# Guidance for Google Sheets API usage (SPA, multi-user)

## Purpose of this document

This document records early design reasoning and practical lessons learned when evaluating the Google Sheets API as a shared coordination and visibility surface for a multi-user, SPA-only application.

The intended audience is:
- primarily myself, as a durable design memory,
- secondarily future LLM-assisted design and coding sessions, to anchor assumptions, boundaries, and trade-offs.

This is a **descriptive** document. It captures what was discussed and why certain directions currently appear viable, not a final or normative architecture.

---

## High-level goal

Use Google Sheets as a **human-readable, real-time-ish progress board** for work executed by multiple browser-based SPAs, without introducing a backend service at this stage.

Key motivation:
- Humans can observe progress directly in Sheets without training.
- Minimal infrastructure.
- Acceptable consistency trade-offs given low concurrency and cooperative clients.

Sheets is **not** treated as a database of record, nor as a strongly consistent coordination mechanism.

---

## Core design outline

Two sheets are used:

1. **Log sheet**
   - Append-only.
   - Written using `spreadsheets.values.append`.
   - Intended for audit/debugging and coarse visibility (e.g. job completed, job failed).
   - Not used as the primary recovery mechanism.

2. **Status sheet**
   - Fixed set of rows; no rows are added or deleted while SPAs run.
   - Each row represents one job.
   - Only a small set of columns are updated, primarily:
     - `Status`
     - `worker_session_id` (added explicitly to support recovery and stale detection)
   - Updates are performed using `spreadsheets.values.batchUpdate`.

---

## Explicit assumptions (must remain true)

The following assumptions are **design constraints**, not accidental properties.
If any of these change, the design must be re-evaluated.

- Only SPAs modify the sheet while work is running.
- Humans may observe but do not sort, filter, or edit during execution.
- Rows are **pre-partitioned by Google Account (email)**.
  - Each SPA only touches rows belonging to the OAuth-authenticated user.
- No two SPAs ever intentionally update the same row.
- Status updates are **coarse-grained** (e.g. claimed → final outcome).
- Near-real-time visibility (≈0.5–1 s latency) is sufficient.
- Occasional loss of the last ~1 s of status visibility is acceptable.
- No backend service is present.
- No attempt is made to defend against malicious or buggy clients.
- Cross-device continuation (resume on another browser/machine) is not guaranteed and is delegated to humans.

These assumptions are acceptable for the current phase.

---

## Sheets API characteristics that matter

### Writes are the limiting factor

- Row count (hundreds to tens of thousands) is not the primary issue.
- Write request rate and quota consumption are the real constraints.
- Naïve per-row, per-transition updates will exceed practical limits quickly.

### Batching is mandatory

- All non-trivial updates must be coalesced using:
  - `spreadsheets.values.batchUpdate`
- Flush interval guidance for this case: ~2 seconds.
- Many non-contiguous cells can be updated in a single request.

Batching trades immediacy for survivability.

### Sheets API request limits (rate limits / quotas)

Google Sheets API v4 uses **per-minute** request quotas (refilled every minute). The key limits for this design are:

- **Read requests**
  - 300 requests / minute / project
  - 60 requests / minute / user / project
- **Write requests**
  - 300 requests / minute / project
  - 60 requests / minute / user / project

Implications for an SPA-only design:
- The **60 writes/minute/user/project** limit is typically the first one to bite if the client flushes too frequently.
- Design for headroom (retries + log appends). As a rule of thumb, target substantially below 60 sustained write requests per minute per active user.

Where to find the latest numbers:
- Official documentation: [Google Developers → Workspace → Sheets API → `Usage limits` page.](https://developers.google.com/workspace/sheets/api/limits)
- Operationally: in Google Cloud Console for the project (Quotas / API & Services), which is the place to verify effective limits and request adjustments if ever needed.

---

## Status update strategy

### Claim-and-complete model

1. **Claim phase**
   - A batch of rows (e.g. 5–10) is claimed.
   - `Status = STARTED`
   - `worker_session_id = <uuid>`

2. **Local execution**
   - Intermediate state is kept locally only.
   - No further Sheet writes during execution.

3. **Completion phase**
   - Rows are updated in batch:
     - `Status = DONE` or `FAILED`
     - `worker_session_id` unchanged (for traceability)

This minimizes write volume and avoids fine-grained coordination in Sheets.

---

## Local durability and crash recovery (SPA-only)

Because batching defers writes, local durability is required.

### Local journal

- Use IndexedDB to store a small local journal of intended updates.
- Write to IndexedDB **before** enqueueing an update for Sheets.
- On successful batchUpdate, mark or clear committed entries.

This survives:
- tab crashes,
- browser crashes,
- short offline periods.

Browsers may be asked for persistent storage via `navigator.storage.persist()`, but this is best-effort.

### Restart behaviour

On SPA startup or reload:
- Scan owned rows in the Status sheet.
- Rows with:
  - `Status = STARTED`
  - `worker_session_id` not equal to the current session
- Are treated as **stale** and reset or re-queued according to policy.

Exact recovery semantics are intentionally simple and human-resolvable.

---

## Role of the log sheet

- Appends count against quota like any other write.
- Therefore the log sheet must be **low-frequency**:
  - per job completion,
  - per error,
  - not per micro-step.

The log is supplementary:
- useful for audit and debugging,
- not relied upon for correctness or recovery.

---

## Row identity and stability

- Row numbers are fragile if humans sort or filter.
- If sorting/filtering ever becomes necessary, a stable `job_id` column will be required and row lookup must be done by scanning key columns.
- Current design assumes no sorting/filtering during execution.

---

## When this design stops being appropriate

Move away from an SPA-only Sheets-based coordination model if:

- Write frequency grows substantially.
- Concurrency approaches worst-case regularly.
- Cross-device continuation becomes a requirement.
- Strong correctness or invariants are needed.
- Humans must freely edit/sort/filter while work runs.

At that point:
- Sheets should become a **projection/dashboard**,
- a backend service should own coordination and state.

---

## Summary of lessons learned / recommendations

- Treat Google Sheets as a **visibility surface**, not a database.
- Batch writes aggressively; never write per micro-transition.
- Accept coarse-grained state and human-assisted recovery.
- Encode session ownership explicitly (`worker_session_id`).
- Use local durable storage (IndexedDB) to bridge batching gaps.
- Clearly state and defend assumptions; this design depends on them.
