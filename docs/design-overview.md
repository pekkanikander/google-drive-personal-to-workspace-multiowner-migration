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
   - Copying those files from personal Drive into the pre‑created Shared Drive structure.

These two roles are never merged; each API call is executed under exactly one identity.

---

## Service Account and Permissions

The Workspace service identity is a **Google Cloud service account** that also participates as a principal inside Google Drive.
It has two distinct kinds of permissions:

1. **Google Cloud IAM permissions** — allow the service account to run the backend (Cloud Run, Firestore, etc.).
2. **Google Drive sharing roles** — determine what the service account can see and do inside Drive.

For Drive, the design assumes:

- On the **source personal folder tree**:
  - The personal owner (or another editor) shares the root folder with the service account as **Viewer**.
  - This is sufficient for the service account to enumerate the tree and read metadata for manifest creation.

- On the **destination Workspace Shared Drive**:
  - The service account is added as a **Manager** of the Shared Drive.
  - This allows it to create and move folders and files, manage content, and—if needed—grant and later revoke write access for personal users during migration.

The service account will call the Drive API using its own identity to:

- Create the destination folder hierarchy.
- Store and update manifest files in the Shared Drive.
- Perform other admin‑level maintenance operations on the destination structure.

Personal users, by contrast, use their own OAuth identities only to access and copy their personal files; they do not need direct knowledge of the service account.

---

## High‑Level Workflow

### 1. Admin Setup

1. Admin installs the Workspace Web App (Marketplace or private deployment).
2. Admin provides:
   - URL of the shared personal Drive folder to migrate.
   - Target Shared Drive (via UI selection or pasted URL).
3. The app ensures the Workspace service identity has access to the source folder.
   If not, the admin is guided to share access to the app’s service account.
4. The app **enumerates** the source tree:
   - Builds a complete folder + file manifest.
   - Identifies file owners.
   - Records folder structure and destination folder mapping in the manifest.
5. The app **creates** the full destination folder hierarchy in the Workspace Shared Drive.

The result is a migration job with a stable manifest and a per‑file-owner work plan.

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

---

### 3. User‑Initiated Migration

When a personal user opens the link they have received:

1. The user authenticates via Google OAuth.
   This asks them to log in first to their personal Google account, if they haven't yet.
2. The app backend records the user identity and obtains a refresh token.
3. The system queues migration tasks for that user:
   - Each task copies exactly one file owned by the user.
   - Tasks run in background workers (Cloud Run / Cloud Tasks).
4. User sees a progress page (“N of M files copied”).
5. User may close the browser; migration continues independently.
6. Re-opening the link shows the progress page as long as the OAuth session is valid.

---

### 4. Copying Files to Workspace

For each file owned by the user:

- Backend performs `files.copy` under **user credentials**.
- Destination parent is the Workspace Shared Drive folder that corresponds to the source folder.
- Errors (quota, rate limit, permissions) are logged and retried when appropriate.
- Completed operations are marked in the manifest.

No ownership transfer occurs; Google strictly prohibits that for personal → Workspace files.
Copy semantics are the only allowed mechanism.

---

### 5. Admin Console

The admin console shows:

- List of all owners discovered.
- Whether each user has authorised the app yet.
- How many files per user are migrated / pending / failed.
- Logs for troubleshooting.
- Optionally (later), the ability to re‑queue failed operations.

This allows the admin to confirm that the full multi‑owner migration has been completed.

---

## Design Constraints

- **No impersonation of personal accounts.** Each user must complete OAuth themselves.
- **No ownership transfer.** The system performs only copies.
- **Long‑running operations must be queued.** UI requests cannot block during migration.
- **Folder structure is created once**, centrally, by the Workspace identity.
- **Idempotency** is required: re‑running migration for a user should not duplicate files.

---

## Open Design Questions (for future refinement)

- Should the backend be Apps Script only, or Cloud Run + Firestore for better scalability?
  - Initial answer: Only Cloud, no Apps Scripts
- How should repeated migrations be handled if the personal source folder changes after initial enumeration?
  - Initial answer: Requires a new (re)run of the tool. Without a rerun, no new files are detected and deleted ones fail.
- Should the admin be allowed to override destination paths for selected subtrees?
  - This may be a later option. Not in the first version.
- How should Forms, Sheets with linked responses, or short-lived access tokens be handled?

These will be iterated as implementation proceeds.

---

Next step: refine the admin and user workflow documents.
