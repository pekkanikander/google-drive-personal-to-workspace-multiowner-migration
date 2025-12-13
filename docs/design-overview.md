# Design Overview

This document summarises the planned architecture, roles, and workflow for the present project.
We describe how the system coordinates actions between a Workspace administrator,
a Workspace‑scoped service account, and multiple personal Google account users whose files are being migrated.

---

## Goals

- Provide a **web‑based**, minimal‑friction workflow for non‑technical users.
- Support migration of **mixed‑ownership** personal Google Drive folder trees into a **single Workspace Shared Drive**.
- Ensure clarity, reproducibility, and auditability of the entire process.
- Remain fully within Google’s documented permission and API constraints.
- Enable running with minimal infrastructure: static hosting + OAuth + Drive files as the only durable state.


---

## Key Architectural Idea

The migration process relies on two (sets of) identities, each performing different tasks:

1. **Workspace Service Identity (Google Cloud service account)** (single identity)
   Used for:
   - Enumerating the shared personal folder tree (once granted access to it).
   - Creating the target folder structure inside a Workspace Shared Drive.
   - Managing manifests, job metadata, logs, and verification reports.
     - The manifest is stored in the target Workspace Shared Drive
       - Later the app should allow the Admin to select the location for the manifest.

2. **Personal User Identities (OAuth login)**
   Used for:
   - Authorising access to files owned by that personal account.
   - Running the selected transfer mode (move, move+restore copy, or copy) from personal Drive into the pre-created Shared Drive structure.

These two roles are never merged; each API call is executed under exactly one identity.

For at least an alpha, the project targets a **two-SPA** deployment where the coordination
 “database” is implemented purely as Drive files inside the destination Shared Drive.

---

## Service Account and Permissions

The Workspace service identity is a **Google Cloud service account** that also participates as a principal inside Google Drive.
It has two distinct kinds of permissions:

1. **Google Cloud IAM permissions** — allow the service account to run the backend, if so desired (Firestore, etc.).
2. **Google Drive sharing roles** — determine what the service account can see and do inside the destination Drive.

For Drive, the design assumes:

- On the **source personal folder tree**:
  - The personal owner (or another editor) shares the root folder with the service account as a **Viewer**.
  - This is sufficient for the service account to enumerate the tree and read metadata for manifest creation.

- On the **destination Workspace Shared Drive**:
  - The service account is added as a **Manager** of the Shared Drive.
  - This allows it to create and move folders and files, manage content, and — if needed — grant and later revoke write access for personal users during migration.

The service account will call the Drive API using its own identity to:

- Create the destination folder hierarchy.
- Store and update manifest files in the Shared Drive.
- Perform other admin‑level maintenance operations on the destination structure.

Personal users, by contrast, use their own OAuth identities only to access and move/copy their personal files according to the selected mode; they do not need direct knowledge of the service account.

### Early Alpha note

The early alpha implementation may omit a backend and may also omit a service account entirely,
provided the admin can perform preparation steps via OAuth in the browser.
The service-account-centred approach remains a supported architecture direction for later iterations.

If such mode is good enough, creating a backend may be completely skipped or delayed for a long time.


---

## High-Level Workflow

### 1. Admin Setup

1. Admin installs the Workspace tool
   - Packaging of the tool is open.  A Google Workspace App at the Marketplace is desired but hard.
   - Initial packaging planned as open source, install yourself app.
   - Admin will need to create the Workspace service account (preferably programmatically)
     - This needs to be documented and hopefully (semi-)automated.
2. Admin provides:
   - URL of the shared personal Drive folder to migrate.
   - Target Shared Drive (via UI selection or pasted URL).
3. The app ensures the Workspace service account has access to the source folder.
   If not, the admin is guided to share access to the app’s service account.
   - This may be the most complicated step to a rookie admin. UX attention needed here.
     - It may be beneficial to see if OAuth could help here as well.
4. The app, running as the service account, **enumerates** the source tree:
   4.1 Folder tree enumeration
   - Enumerates the source folder tree and creates a copy of the tree (folders only) at the destination.
   4.2 Manifest creation
   - Enumerates the source folder tree a second time
   - Identifies <source file ID, owner, destination folder ID> triplets.
   - Records these triplets into the manifest.
   At the implementation level, the two enumerations should be folded even though
   they are architecturally separate.

The results are
- a copy of the source tree at the folder level
- a migration job with a stable manifest and a per‑file-owner work plan.

---

### 2. Providing User‑Facing Migration Entry Points

A crucial insight here is that for each separate file owner in the shared persona drive folder,
there needs to be a separate session, with a separate OAuth provided personal user identity.

The system generates a **migration link** for the job.
The link contains a random job token (not an authentication secret) and directs users to a simple web page that:

- Explains the migration.
- Asks the user to log in with their personal Google account.
- Guides the user to grant authorization to the app via the Google OAuth dialog.
- Shows how many files they own according to the manifest.
- Optionally (later) shows a list the files to be copied.

This link is sent by the admin to all the users that have files in the shared personal folder.
- At a later version of the tool, this email sending should also be automated.

---

### 3. User‑Initiated Migration

When a personal user opens the link they have received:

1. The user authenticates the app via Google OAuth.
   - This asks them to log in first to their personal Google account, if they haven't yet.
2. The web app processes the manifest file-by-file, recording progress.
   - Moves or copies exactly one file owned by the user at a time.
3. User sees a progress page (“N of M files copied”).
4. User shall keep the browser window open.
   - If the user closes the browser window or if the connection is dropped,
   the tool shall continue the copy from where it was left.  This may require some recovery logic in the later versions of the tool.
5. Re-opening the link just continues as long as the OAuth session is valid.

---

### Transfer Modes

Every migration job chooses exactly one user-facing mode:

1. **Move (default)** — removes files from the personal folder tree and adds them to the Shared Drive tree at the appropriate place (`files.update` with `addParents`/`removeParents`). The file keeps its ID; it simply lives in the Shared Drive afterwards.
2. **Copy** — leave the original untouched and only create a same-name copy (new ID) in the Shared Drive.
3. **Move + Restore Copy** — performs the move (so the Shared Drive now hosts the original file), then immediately creates a same-name copy back into the original personal parent so that any users looking for the file there still see the file, though not with a separate ID.  (This mode is not recommended.)

For alpha, the scope includes Google Forms and associated response destinations (where accessible via the owner’s credentials), but excludes shortcuts and other indirect references.

Additionally, in later version of the tool, there may be an option where the Moving also places a README or similar file at each source folder, allowing users that look for the originals to find the their new location.

In the case of move, the tool should later be able to optionally sanitise the file’s sharing permissions
(dropping file-level ACLs).
This feature is deferred to late-alpha / pre-beta.

All modes run per file and are idempotent with manifest tracking. Ownership transfer never occurs; everything stays within Google’s permitted semantics.

Moves keep IDs intact, so downstream references/bookmarks continue to work; the restore/copy variants control whether collaborators still see a file in the source location and whether a new ID is introduced there.

### 4. Content Transfer to Workspace

For each file owned by the user:

- The Web app performs the job’s configured transfer mode under **user credentials**.
- Destination parent is always the Workspace Shared Drive folder that corresponds to the source folder.
- Errors (quota, rate limit, permissions) are logged and retried when appropriate.
- Completed operations are marked in the manifest, allowing intelligent recovery and continuation.

No ownership transfer occurs; Google strictly prohibits that for personal → Workspace files.
Only moving/copying semantics allowed by the Drive APIs are used.

---

### 5. Admin Console

The admin console shows:

- List of all owners discovered.
- Whether each user has authorised the app yet.
- How many files per user are migrated / pending / failed.
- Logs for troubleshooting.
- Coordination store: shared durable state is stored as Drive files (manifest/progress/logs) in the destination Shared Drive.
- Destination access: personal users may be granted temporary Shared Drive Manager access during migration, to be revoked by default upon completion.

- Optionally (later), the ability to re‑request failed operations.

This allows the admin to confirm that the full multi‑owner migration has been completed.

---

## Design Constraints

- **No impersonation of personal accounts.** Each user must complete OAuth themselves.
- **No ownership transfer.** The system performs only Drive moves/copies that respect existing ACLs (moves keep IDs; copies create new IDs).
- **Long‑running operations must be resumable.** If a backend exists, it may queue work; in a SPA‑only model, the UI must support stop/resume without duplication.
- **Folder structure is created once**, centrally, by the Workspace identity.
- **Idempotency** is required: re‑running migration for a user should not duplicate or lose files.

## Multi‑parent files (alpha handling)

Google Drive historically allowed a single file to have multiple parent folders (conceptually similar to Unix hard links). Such files still exist in older Drives, even though creating new multi‑parent files is no longer supported.

Shared Drives enforce a strict tree structure (exactly one parent per file), so multi‑parent topology cannot be preserved at the destination.

**Alpha behaviour:**

- During enumeration, files with more than one parent are detected and recorded.
- These files are **excluded from automatic migration** in alpha.
- The admin console presents a list of such files so they can be handled manually.

This keeps the alpha implementation simple and avoids silently collapsing structure. Later versions may add statistics collection and configurable handling strategies (collapse, duplicate, or guided admin choice).

---

## Open Design Questions (for future refinement)

- Should there be any backends at all, or can both the Admin console and the user flow be delivered as static SPAs ("two‑SPA" model)? See `design-two-spas.md`.
- If a backend exists, what should its minimal role be (e.g. enumeration/manifest only vs. full orchestration), and where should it run (Firebase/Cloud Run/etc.)?
- How should repeated migrations be handled if the personal source folder changes after initial enumeration?
  - Initial answer: Requires a new (re)run of the tool. Without a rerun, no new files are detected and deleted ones fail, as the manifest stays the same.
- Should the admin be allowed to override destination paths for selected subtrees?
  - This may be a later option. Not in the first version.
- How should edge cases be handled (Forms + response Sheets, multi-parent files, and token/session expiry during long runs)?
- How do we mitigate the risks enumerated in [docs/risks.md](docs/risks.md) (service-account visibility, admin workflow overhead, temporary permissions, manifest storage, etc.)?

These will be iterated as implementation proceeds.
