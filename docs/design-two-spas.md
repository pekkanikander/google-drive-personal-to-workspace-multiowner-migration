# Two SPA based implementation

## Summary

This document describes an implementation variant where **both** the Admin console and the per‑user migration UI are delivered as **static single‑page applications (SPAs)**.

The key goal is to avoid relying on a publicly invokable backend (e.g. Cloud Run), which may be blocked by secure‑by‑default Workspace organisation policies (notably `iam.allowedPolicyMemberDomains`).

In this model:

- **Admin SPA** prepares the job (enumeration, destination folders, ACLs, manifest).
- **User SPA** performs the actual per‑user transfer using the user’s own OAuth token.
- Shared state (manifest, progress, logs) is stored in Google Drive (typically the destination Shared Drive) using normal Drive files and ACLs.

This keeps deployment close to “static hosting + OAuth client”, while still enabling robust, resumable migrations.

---

## Design goals

- End users can complete their part with only:
  - a web link,
  - a personal Google login,
  - an OAuth consent prompt.
- Admin setup is achievable by a competent Workspace admin who is new to GCP.
- No reliance on public Cloud Run invocation for end users.
- Clear security boundaries: users can only read/write what Drive ACLs permit.
- Resume support: users can stop and continue without duplicating files.

## Alpha decisions

For the alpha implementation, the following simplifying choices apply:

- **Coordination database:** all shared state is stored as ordinary Drive files inside the destination Shared Drive (no Firestore / backend DB).
- **Destination access (temporary):** each participating personal user is granted **temporary Shared Drive Manager** access to complete their migration. After that user’s migration is complete, the tool revokes that access by default (unless the admin chooses to keep it).
- **Scope:** migrate only items that are actual files in the source tree (including Google Forms and their response destinations). Do **not** attempt to migrate shortcuts, “shared with me” items, or other indirect references.
- **Permission sanitising:** optional post-migration sanitising that drops file-level ACLs is deferred to late-alpha / pre-beta.


## Roles and identities

### Admin

A Workspace admin (or other trusted operator) who:

- Has access to the shared personal source folder tree (at least Viewer).
- Has sufficient privileges on the destination Shared Drive (Manager recommended).

Admin actions are executed under the admin’s OAuth identity in the browser.

### Personal user

A personal Google account user (often `@gmail.com`) who:

- Owns some subset of files in the shared personal source tree.
- Performs migration operations only for files they own.

User actions are executed under the user’s OAuth identity in the browser.

---

## State model: Drive as the coordination layer

Without a backend, the system still needs shared, durable state. This variant uses Drive itself:

- A **job folder** is created under the destination Shared Drive, for example:

  `Shared Drive / Migration Jobs / <job-id>/`

- The job folder contains:

  - `manifest.json` (admin‑written, user‑read)
  - `users/<email>/progress.json` (user‑written, admin‑read)
  - `users/<email>/errors.json` (optional, user‑written, admin‑read)
  - optional `reports/` (admin‑written)

### ACL rules (later)

- `manifest.json`:
  - readable by all participating personal users
  - writable only by admin (and optionally service account if used)

- `users/<email>/`:
  - writable by that personal user
  - readable by admin
  - not writable by other users

This avoids a central writable file shared across users.

For alpha, the simplest workable model is used, instead of the one above:

- Participating personal users receive **temporary Shared Drive Manager** access during their migration window.
- The tool revokes that access by default once the user’s file set is complete (unless the admin opts out).

This intentionally trades security for speed of delivery in alpha. Later versions should move towards per-user destination subtrees and narrower roles.


---

## Admin SPA

### Responsibilities

- Create a migration job folder in the destination Shared Drive.
- Enumerate the source folder tree:
  - create the destination folder structure
  - build a per‑owner work plan
- Generate and write `manifest.json`.
- Provision per‑user destination folders and ACLs.
- Provide per‑user entry links to the User SPA.

### Inputs

- Source root folder URL/ID (personal Drive, shared to admin).
- Destination Shared Drive and root folder.
- Transfer mode (move/copy/move+restore copy) and options.

### Outputs

- Destination folder tree (folders only initially).
- `manifest.json` and per‑user target folder IDs.
- Per‑user destination ACLs.
- A set of user links (URL + job id + optional user hint).

### Manifest content (conceptual)

At minimum:

- `job_id`, `created_at`, `source_root_id`, `dest_root_id`, `transfer_mode`
- per‑user sections keyed by email:
  - `dest_user_root_id`
  - list of file tasks: `{ source_file_id, source_parent_id, dest_parent_id, owner_email, kind }`

The manifest is treated as immutable for a job run (append‑only reports can be separate).

---

## User SPA

### Responsibilities

- Authenticate the user via OAuth in the browser.
- Read the manifest.
- Verify eligibility:
  - user email exists in manifest
- Execute the configured transfer mode for that user’s file set.
- Write progress to `users/<email>/progress.json`.

### Transfer semantics

- **Move**: use `files.update` with `addParents` / `removeParents`.
- **Copy**: use `files.copy` with `parents=[dest_parent_id]`.
- **Move + Restore Copy**: move, then copy back (discouraged; documented as such).

### Progress tracking

Store per‑task state such as:

- `pending | in_progress | done | failed`
- last error (code/message)
- timestamps

Progress should support resuming:

- On page reload, the SPA reads `progress.json` and continues from the next pending item.

---

## Hosting and deployment

### Static hosting

Both SPAs can be hosted as static sites:

- Firebase Hosting
- Cloud Storage static hosting
- GitHub Pages / Netlify / similar

This avoids Cloud Run invocation for user traffic.

### OAuth client configuration

Two broad patterns are possible:

1. **Separate OAuth clients** for Admin SPA and User SPA.
2. **Single OAuth client** if redirect origins match and this materially simplifies setup.

The install documentation should aim for the least confusing admin experience.

---

## Security considerations

### Token exposure

- OAuth access tokens exist in the browser runtime.
- This is acceptable only if:
  - the SPAs are served over HTTPS,
  - release artefacts are reproducible and verifiable,
  - users are advised to use trusted links.

### Destination write boundary

- **Alpha:** users are granted temporary Shared Drive Manager access, then revoked by default after completion.
- **Later, maybe:** restrict users to a constrained destination subtree (per-user roots) and narrower roles.
  - Users must only receive write access to a constrained destination subtree.
  - Prefer per‑user destination roots; avoid granting users broad Shared Drive access.

### Manifest integrity

- Users must not be able to edit `manifest.json`.
- User progress files must be isolated per user.

---

## Operational characteristics

### Pros

- No publicly invokable backend is required.
- Deployment can be “static hosting + OAuth client + Drive ACLs”.
- Secure‑by‑default Workspace org policies are less likely to block static hosting.
- User operations are naturally least‑privilege (bounded by their own token + Drive ACL).

### Cons

- Admin work runs in the browser session (long enumerations require resumability).
- No central queue/worker without adding a backend.
- Quota/rate limiting is distributed across user browsers; retry logic must be robust client-side
  - (and account for broad Manager access in alpha).
 - Admin dashboard aggregates state by scanning per-user progress files.

 ---
- Admin dashboard aggregates state by scanning per‑user progress files.

---

## Relationship to other architecture variants

This model keeps the backend optional:

- A future backend (Cloud Run, Cloud Functions, etc.) may still be used for:
  - enumeration and manifest creation (admin‑triggered),
  - long‑running batch operations,
  - advanced reporting.

But the critical user‑facing flow remains viable without requiring public Cloud Run invocation.
