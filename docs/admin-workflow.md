# Admin workflow design

This document describes the planned workflow for Workspace administrators.
It is written **as a design specification for implementors**, not as instructions for real admins.
Its purpose is to outline the expected behaviour, state transitions, and UI/UX elements that the migration system will need to provide.

The workflow reflects the constraints of Google Drive, the need for multi-owner migrations, and the requirement that the admin’s experience be predictable, recoverable, and auditable.

---

## 1. Entry Point: Admin Installs the Application

### 1.1 Installation context
The application may be distributed in multiple forms, depending on organisational constraints and maturity:
- As two **static web applications (SPAs)**: one for admins and one for end users, hosted on static hosting (local, Firebase Hosting, or similar).
- As a hybrid system: SPAs for UI combined with a backend service (e.g. Cloud Run) for enumeration, orchestration, or long‑running tasks.
- Potentially, in later stages, as a Workspace Marketplace or private Workspace app.

The initial design explicitly keeps these options open.

During installation, the admin is asked to approve:

- Scopes required by the Workspace service identity (Drive access for Shared Drives).
- Optional domain-wide delegation for Workspace accounts (but not personal accounts).

The installation process must surface the minimal set of scopes required to avoid consent fatigue.

### 1.2 Post-install first-run
Once installed, the admin opens the application’s UI from the Workspace App Launcher or through a `localhost` URL, given by the command like command used to serve the app from the local workstation / laptop.

The first-time experience should:

- Detect that no migration jobs exist yet.
- Present a “Create new migration job” workflow.
- Display the service account identity the admin must share folders with, if any.
- Indicate whether a backend component is configured or whether the system is operating in a SPA‑only mode.

---

## 2. Admin Creates a Migration Job

### 2.1 Admin provides the source folder
The UI asks the admin to paste a URL to the **root folder of the shared personal Drive tree**.
This folder is owned by a personal Gmail user but is shared with the admin.

Design requirements:

- The system extracts the folder ID.
- The system checks whether the Admin SPA and/or the backend Workspace service identity has access.
- If not, the UI shows:
  - The Admin and/or service account email(s).
  - Clear instructions for the admin to share the folder with that/those account(s).
  - A “Check access again” button to retry once sharing has been applied.

This must be implemented defensively: ambiguity in access status should not allow the workflow to continue.

### 2.2 System validates the folder and begins enumeration
Once access is confirmed:

- The system performs a full, recursive enumeration of the source folder tree.
  - This may run in an admin‑side SPA (using the admin’s OAuth identity), or
  - via a backend service identity, if such a backend is configured.
- For each file and folder, it records:
  - Item ID.
  - Name.
  - MIME type.
  - Path relative to the job root.
  - Owner email (from Drive metadata).
  - Whether it is a Google Document type or binary.

This produces the **source manifest**, the foundation of the entire migration job.

### 2.3 Admin selects the Workspace destination
The UI now asks the admin to choose a Workspace Shared Drive:

- List all Shared Drives where the service identity has writer access.
- If necessary, allow pasting a Shared Drive or folder URL.

The selection must be stored permanently as part of the job definition.

### 2.4 System creates the destination folder structure
Using the source manifest, the admin SPA / backend reconstructs the folder hierarchy inside the chosen Shared Drive.

This operation may be executed:
- directly from the admin UI in a SPA‑only deployment, or
- by a backend service performing idempotent folder creation on behalf of the admin.

This requires:

- Creating folders in topological order.
- Recording `sourceFolderId → destinationFolderId` mappings.
- Ensuring idempotency if the admin re-runs structure creation.

After this step, the job is fully initialised.

### 2.5 Admin chooses the transfer mode

Before inviting users, the admin must pick one of the supported per-job modes:

1. **Move (default)** — remove files from personal Drive and place them in the Shared Drive; the file keeps its ID.
2. **Copy** — leave the original untouched (original ID remains) and only create a same-name copy with a new ID in the Shared Drive.
3. **Move + Restore Copy** — move (ID now lives in the Shared Drive), then recreate a same-name copy in the original location (the restored file has a new ID) so collaborators still see a file.

The UI documents the implications (e.g. whether files disappear from the personal folder). The chosen mode is stored in the job definition and cannot be changed once user migrations start.
In practice, move-based modes preserve downstream references because the ID doesn’t change; the restore-copy variant simply repopulates the personal folder with a new-ID placeholder.

---

## 3. Multi-Owner Planning and Communication

### 3.1 Extracting owners
From the manifest, the system determines all distinct personal-owner email addresses.

The admin sees a list such as:

- user1@gmail.com — 231 files
- user2@gmail.com — 14 files
- ...

Only owners with at least one file should appear in the actionable list.
As the owners are collected from the tree, there should never be any owners without any files; no need to check for such a condition.

### 3.2 Generating the user onboarding link
The system generates a **job-scoped onboarding URL**, which:

- Contains a random token mapped to the job.
- Does not identify any specific user.
- Directs the visitor to the user-facing migration page.

The admin receives this link and is instructed to distribute it to the contributors.  A later version of the tool may allow the admin to distribute directly from the tool, the tool sending the email/message.

### 3.3 Expectations communicated to the admin
The UI shows:

- All owners discovered.
- Their current status: *not started*, *authorized*, *in progress*, *complete*, *errors*.
- The meaning of the onboarding link (one link for all users, but the system recognises users by OAuth identity).

The admin is expected to send the onboarding link to each contributor.

---

## 4. User Authorisation Phase (from Admin Perspective)

The admin console should show real-time transitions:

- **Not yet authorised** → a user has not clicked the link.
- **Authorised** → user has signed in with OAuth and granted permissions.
- **Migration queued** → tasks have been scheduled for that user.
- **In progress** → background workers are transferring files according to the selected mode.
- **Completed** → all files for that user have been migrated.
- **Errors** → manual review might be needed.

The admin must always be able to refresh the view safely.

---

## 5. Migration Execution (Admin-side Responsibilities)

Depending on deployment mode, migration execution may be:
- fully user‑driven (SPA‑only), where each user’s browser performs the transfers and records progress, or
- orchestrated by a backend, where tasks are queued and executed by workers after user authorisation.

The following subsections describe the backend‑orchestrated variant; SPA‑only execution maps similar responsibilities into the user UI.

### 5.1 Task scheduling
In a SPA‑only variant, explicit task queues may not exist; instead, the user UI iterates over its assigned tasks and records progress files.

For each authorised user:

- The backend prepares a list of file-transfer tasks using the destination folder mapping.
  - Each task records the transfer mode to execute (move, move+restore copy, copy).
- Tasks are placed in a queue (Cloud Tasks, Firestore job table, etc.).
- Each task carries:
  - File ID.
  - Destination folder ID.
  - User identity (for OAuth token lookup).
  - Retry metadata.

### 5.2 Running tasks
Workers consume tasks:

- Use the personal user token to perform the configured transfer operation.
- Write logs to the job’s data store.
- Mark success or schedule retry.

The admin console reflects this progress.

### 5.3 Error cases
Errors are surfaced in the admin UI with category labels, e.g.:

- Permission denied (unlikely if source manifest was correct).
- Rate limit exceeded (auto-retry).
- Token expired (requires user action).
- Unexpected API conditions.

The admin can trigger a requeue for a specific user’s failed tasks.

---

## 6. Job Completion and Verification

After all users show **Completed**:

1. The system verifies that:
   - Every file has a corresponding destination object (moved, moved+restored, or copied as configured).
   - Destination folder structure is consistent.
   - Task logs indicate no unhandled failures.

2. The admin UI displays:
   - Total files transferred (mode-dependent).
   - Total users who participated.
   - Summary of any warnings.

3. Optionally, the system can export:
   - A final manifest mapping original → destination file IDs (post-move/copy).
   - A migration report for archival.

The admin may then notify contributors that the migration is complete.

---

## 7. Non-Goals in the Admin Workflow

- Admin cannot impersonate a personal Gmail user.
- Admin cannot transfer ownership from personal → Workspace.
- Admin cannot modify the source folder tree during migration.
- Admin cannot force a user’s migration without their OAuth consent.

These constraints mirror Google Drive’s security model.

---

## 8. Future Extensions

Potential future enhancements include:

- Ability to merge multiple job roots into a single Workspace structure.
- Optional “dry run” mode for enumeration and structure creation.
- Bulk email sending directly from the app.
- Detecting and warning about deleted or renamed source items during migration.

These are not required for the initial implementation but guide long-term architecture.
