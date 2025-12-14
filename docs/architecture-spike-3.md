# Architecture spike 3: Verify that the Admin (SPA) can enumerate the personal source tree

## Purpose

This spike verifies that an **admin running in a browser SPA** (using their own OAuth token, no backend, no service account) can reliably enumerate a legacy personal Drive folder tree that has been shared to them and gather sufficient metadata to build the manifest.

Whereas spike 1 focused on a server-side copy and spike 2 proved that personal users can move files into Shared Drives directly from a static SPA, this spike focuses on the **read-only, admin-side** view of the *source* tree in the two-SPA model (see `design-two-spas.md`).
We need to confirm that the admin SPA can build the manifest that later enables the per-user move/copy operations and store it in Drive.

## Questions this spike must answer

1. Can an admin (with Viewer access to the personal root) recursively list all files and folders in that tree using only browser-side OAuth?
2. Does the admin see the same structure as the personal owner (names, hierarchy, shortcuts, etc.)?
3. For each item in the tree, can we reliably obtain at least the following fields via the Drive API (enough to construct the manifest used by user migrations):
   - `id`
   - `name`
   - `mimeType`
   - `parents`
   - `owners[]` (email addresses)
   - `driveId` or indication of which Drive it lives in
   - `trashed`
   - `shortcutDetails` (for shortcuts)
   - `permissions[]` (at least the owners and explicit shared users)
4. Are there any classes of items that the admin **cannot** see, even though they appear in the owner’s UI (e.g. certain special shared items, orphaned files, shortcuts to files outside the tree)?
5. Are there rate-limit or pagination behaviours that will affect large trees (hundreds or thousands of items) in practice?
6. Do we see clues about items the admin can access but the eventual user cannot move (e.g. because the owner is already a Workspace account)? Document any such cases early.
7. Can we write the manifest back into the destination Shared Drive (Drive file) from the admin SPA without a backend?

If any of these fail in a surprising way, the main architecture and manifest format may need to be adjusted.

## Out of scope for this spike

- No copying or modification of files or folders.
- No writes to the source personal Drive tree.
- Only manifest writing to the destination Shared Drive (admin writes output there as a Drive file).
- No backend or service account; runs in the browser (or a simple CLI equivalent for prototyping).
- No multi-user orchestration; only a **single personal source tree** is considered.

## High-level approach

1. **Use the existing OAuth client** (or create a dedicated Admin SPA client) with authorised origins for local/static hosting.
2. From the personal Google account (outside Workspace), share a test root folder to the admin as **Viewer**.
3. Implement a minimal Drive API client that authenticates with the admin’s OAuth token in the browser and:
   - traverses the tree starting from the shared root folder ID,
   - enumerates all items via `files.list` with appropriate query and fields,
   - logs a structured summary of every item.
4. Write the output manifest into the destination Shared Drive as a Drive file (JSON or CSV) using the same admin token.
5. Inspect the output and compare it (spot-check) against what the personal user sees in the Drive web UI.

The spike is successful if the admin can see all expected items and collect the required metadata fields for use in a future manifest.

## Assumptions and prerequisites

- A GCP project with the **Google Drive API** already enabled (from spikes 1 and 2).
- An OAuth client configured for static hosting (Admin SPA) with the necessary Drive scopes.
- One personal Google account (e.g. `example.personal@gmail.com`) that owns a non-trivial folder tree representing legacy content.
- That personal account can:
  - create a test root folder (if needed),
  - move or copy representative files and subfolders under that root,
  - share that root folder to the admin as **Viewer**.

## Admin OAuth setup

1. Configure an OAuth client (Web) for static hosting origins used by the Admin SPA (localhost and planned host).
2. Ensure Drive scopes are permitted for that client (`https://www.googleapis.com/auth/drive`).
3. In the personal Google account’s Drive UI, share the chosen root folder to the admin account as **Viewer** and confirm access.

## Minimal implementation design

This spike can be implemented as a **minimal Admin SPA page** (or, for prototyping, a simple CLI script) that runs under the admin’s OAuth token. It does not need to run in Cloud Run. The implementation should be simple but keep output structured so we can import it into Sheets/JSON for manifest experiments.

### Configuration

- Configurable inputs (hard-coded for the spike or simple form fields):
  - `SOURCE_ROOT_FOLDER_ID` (the ID of the shared root folder in the personal Drive),
  - destination job folder ID in the Shared Drive (where the manifest will be written),

### Authentication

- Use the admin’s OAuth token (GIS token client) with Drive scope.
- No service account or backend token exchange is used; all calls are made from the browser.

### Drive API calls

- Use the Drive v3 API with:
  - `supportsAllDrives=true`
  - `includeItemsFromAllDrives=true`

- Use `files.list` with a query that selects items under the root folder. Two possible strategies:
  - Simple: store `SOURCE_ROOT_FOLDER_ID` and recursively follow `parents` relationships by multiple `files.list` calls.
  - Preferred for the spike: use the `q` parameter to restrict by parent:
    - First, list direct children of the root: `q="'SOURCE_ROOT_FOLDER_ID' in parents and trashed = false"`.
    - Then, recursively process any folders found, repeating the query for each folder ID.

- Request an explicit `fields` mask including at least:
  - `files(id, name, mimeType, parents, owners(emailAddress), driveId, trashed, shortcutDetails, permissions(emailAddress, role, type), createdTime, modifiedTime)`
  - `nextPageToken`

### Data captured per item

For each file, folder, or shortcut, log a single record containing at least:

- `id`
- `name`
- `mimeType`
- `parents` (array of IDs)
- `owners` (email addresses)
- `driveId` (if present)
- `trashed` (boolean)
- `shortcutDetails` (if present: target ID and target MIME type)
- `permissions` (subset: type + role + emailAddress)
- optionally `createdTime`/`modifiedTime` (useful for manifest diffs later)

The output format can be:

- a CSV file, or
- in a second version, a Google Forms sheet

The exact format is not critical as long as it is unambiguous and easy to inspect. Capture enough metadata so that this spike doubles as an early manifest prototype (see risk R4 in `docs/risks.md`).

## Success criteria

The spike is considered successful if:

1. The script can run to completion without errors for a realistic test tree (hundreds or thousands of items).
2. Spot-checking a few folders in the personal user’s Drive UI vs the spike output shows:
   - all folders present,
   - all files present,
   - shortcuts represented in an understandable way.
3. For each item, the recorded metadata is sufficient to later:
   - reconstruct the folder hierarchy,
   - identify the primary owner,
   - understand whether the item is a shortcut or a regular file,
   - decide whether the item is in Trash and should be skipped.

If any classes of items are missing or appear inconsistent, those must be documented and analysed.

## Known risks and observations to watch for

During execution, the implementor should pay attention to:

- **Hidden or orphaned items**:
  - Items that have no parents or live outside the expected tree but are still visible in the UI.
- **Shortcuts to outside resources**:
  - Shortcuts to files in other Drives or owned by other users may behave differently.
- **Shared-with-me behaviour**:
  - Items that appear in "Shared with me" but are not under the shared root folder may not be visible from the admin’s Drive API perspective.
- **Rate limits and pagination**:
  - For large trees, note whether any rate limiting or `userRateLimitExceeded` errors occur.
- **Permission visibility**:
  - The admin token may not see all individual permissions or may see only aggregated information; this must be noted.
- **Shared Drive destination awareness**:
  - Because spike 2 confirmed moves preserve IDs, we must ensure the manifest clearly records the source ID and owning user so that later move/copy operations know who should process each file.

## Expected outcome

If this spike behaves as intended, we will have concrete evidence that:

- An admin using only browser OAuth can act as a **read-only observer** of a legacy personal Drive tree shared to them.
- The Drive API provides sufficient metadata to build a robust manifest for later multi-owner migration and store it in Drive for the user SPA.

The next design steps can then safely assume the existence of an admin-SPA-driven enumeration phase followed by the user-SPA move/copy phase, as outlined in the main design overview and `design-two-spas.md`.
