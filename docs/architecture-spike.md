# Architecture Spike Plan

This document describes a **minimal architecture spike** to validate the core technical assumptions of the project.
The goal is to prove that the dual-identity model (Workspace service identity + personal user OAuth) works end-to-end with the smallest possible amount of code and UI.

The spike is **not** intended to be usable for real migrations. It serves only as a proof-of-concept and a scaffolding for future implementation.

---

## Objectives

The spike should demonstrate that:

1. A Workspace-hosted web application can:
   - Expose an **admin page** and a **user page** under one deployment.
   - Operate with a Workspace service identity (service account) when needed.

2. A personal Google user can:
   - Visit the **user page**.
   - Authorise the app via OAuth (3LO) using their personal Google account.

3. Using the personal user’s OAuth token, the backend can:
   - Access a **fixed source file** in the personal Google Drive (owned or accessible by the user).
   - Copy that file into a **fixed destination folder** in a Workspace Shared Drive.

4. The spike logs enough information to confirm:
   - Which user authorised the app.
   - That the copy operation succeeded (or failed with a clear error).

The spike deliberately avoids everything else.

---

## Out of Scope

The spike will **not** attempt to:

- Enumerate folder trees or build manifests.
- Create or modify folder structures in Workspace.
- Handle multiple users concurrently.
- Implement queues, retries, or progress dashboards.
- Manage token refresh persistence beyond what is necessary to perform a single copy.
- Support production-level security hardening, permissions UI, or localisation.

All of these belong to later implementation phases.

---

## Spike Scenario

The spike simulates the real workflow with the smallest meaningful slice.

### Fixed Inputs

The following values are hard-coded (or configured via environment variables) for the spike:

- **SOURCE_FILE_ID**: ID of a file in a personal Google Drive, owned by or shared to the test user.
- **DESTINATION_FOLDER_ID**: ID of a folder in a Workspace Shared Drive, writable by the service account / app identity.

During testing, the developer manually ensures:

- The test personal account has access to `SOURCE_FILE_ID`.
- The Workspace environment (service account / app) has write access to `DESTINATION_FOLDER_ID`.

No dynamic discovery or configuration UI is needed in this spike.

In the first spike version, test user should be the owner of the source file; this will not be proactively checked.

Destination must be a folder inside a Workspace Shared Drive belonging to the same Workspace as the GCP project; again, this is not validated in the spike.

---

## Components

### 1. Web Application

A small web application deployed in the Workspace’s Google Cloud project, exposing two endpoints:

1. **Admin Page** (e.g. `/admin-spike`)
   - Contains a single button: **“Start Admin View”** (for now it just confirms the app is running).
   - Displays the URL of the **User Page**, for copy & paste.
   - May also display the configured `SOURCE_FILE_ID` and `DESTINATION_FOLDER_ID` for debugging.

2. **User Page** (e.g. `/user-spike`)
   - Contains a **“Start Migration (Spike)”** button.
   - When clicked, initiates the OAuth 3-legged flow for the user’s personal Google account.
   - After successful OAuth, invokes a backend handler that attempts the single file copy.
   - Displays a very simple result:
     - "Copy succeeded" and the new file ID; or
     - "Copy failed" and the raw error message.

For the spike, both the “admin” and “user” roles are played by the developer in two browser windows.

### 2. Identities and Credentials

The spike uses two identity types:

1. **Workspace Service Identity**
   - A service account associated with the Google Cloud project.
   - Granted write access to `DESTINATION_FOLDER_ID` (if needed).
   - Used for any Workspace-level checks or logging (if we decide to do so in the spike).
   - In the first spike version, the service identity is not used for Drive operations.

2. **User OAuth Identity**
   - Obtained via OAuth 3LO when the user clicks **“Start Migration (Spike)”**.
   - Must include Drive scopes sufficient to:
     - Read `SOURCE_FILE_ID`.
     - Perform `files.copy` with `parents=[DESTINATION_FOLDER_ID]`.
   - The test user must be an editor of the destination Shared Drive folder; no permission checks will be performed—failure will surface naturally.

The spike primarily validates that we can **successfully use the user’s OAuth credentials to perform a cross-domain copy into Workspace**.

---

## Sequence of Events

### 1. Admin (developer) opens Admin Page

1. Developer (acting as admin) opens `/admin-spike`.
2. Page loads and shows:
   - A confirmation that the app is running.
   - The URL of `/user-spike`.
   - The fixed IDs (`SOURCE_FILE_ID`, `DESTINATION_FOLDER_ID`) for reference.

This verifies basic routing and deployment.

### 2. User (developer) opens User Page

1. Developer (acting as personal user) opens `/user-spike` in another browser window or profile.
2. Page shows:
   - A short description: “This is an architecture spike; it will attempt to copy one fixed file.”
   - A **“Start Migration (Spike)”** button.

### 3. User authorises via OAuth

1. When the button is clicked, the app redirects to the Google OAuth consent screen.
2. The developer chooses the personal Google account.
3. The user consents to the requested Drive scopes.
4. The app receives an authorisation code and exchanges it for tokens.

For the spike, token persistence can be in memory, or in a simple local store (e.g. a Firestore document or in-memory cache) sufficient for the single call.

Use `prompt=select_account` to force explicit account selection for clarity.

### 4. Backend performs the copy

1. Backend handler (e.g. `/user-spike/callback` or similar) runs under user OAuth credentials.
2. It calls the Drive API `files.copy` endpoint with:
   - `fileId = SOURCE_FILE_ID`.
   - `body = { parents: [DESTINATION_FOLDER_ID] }`.
   - `supportsAllDrives = true`.
3. On success, it returns:
   - The new file ID and name, to be displayed on the User Page.
4. On failure, it returns:
   - The error code and message.

For debugging, the spike should log:

- The user’s email (from the ID token or userinfo endpoint).
- The response from the `files.copy` call.
- Any exceptions encountered.

Logging will include errors and minimal tracing; plain text logs are sufficient even for structured data.

The callback route should perform only the token exchange and minimal identity logging, then redirect the user to a separate route that performs the actual copy. This two-step structure mirrors the intended production architecture, where token handling and job execution are distinct concerns.

For the spike, the second route (`/user-spike/copy-test` or similar) will immediately perform the single `files.copy` operation once the token is available. No long-term token persistence or queuing is implemented yet.

---

## Success Criteria

The spike is considered successful if:

1. The admin page is reachable and shows the user URL and fixed IDs.
2. The user page runs the OAuth flow and returns to the app without errors.
3. After authorisation, the spike successfully copies the one fixed file into the fixed Workspace folder.
4. The developer can see the new file in the target Shared Drive folder.
5. Logs clearly show which personal user performed the action and which file was created.

Failures and edge cases should also be observed:

- Using a personal account that does **not** have access to `SOURCE_FILE_ID` should cause a clear failure.
- Removing write access to `DESTINATION_FOLDER_ID` from the app identity should cause a clear failure.

These behaviours will inform later error handling design.

---

## Minimal Technical Choices

To keep the spike small:

- Use a single small backend (e.g. Cloud Run or App Engine) with two routes.
- Use one OAuth client configuration for the web app.
- Use direct Drive API calls from the backend (no extra abstraction).
- Store configuration (IDs, credentials) in environment variables or a simple config file.
- Minimal checks will be implemented; the spike intentionally fails fast and does not validate preconditions.

No attempt should be made to over-abstract or future-proof beyond what is necessary to answer the architectural questions.

---

## Next Steps After the Spike

If the spike succeeds:

- Generalise the file and folder IDs into configurable parameters.
- Design persistence for user tokens and job metadata.
- Introduce manifest-based planning and multi-owner handling.
- Gradually evolve from a single-file spike to a small per-user batch.

If the spike fails at any point:

- Document the exact failure (OAuth, permissions, Drive API behaviour).
- Revisit assumptions in the main design (docs/design-overview.md) and update accordingly.
- Update the admin/user workflow if needed.

---

## Initial Implementation Plan for this Architecture Spike

This section outlines a concrete but minimal plan for implementing the spike. It is intentionally pragmatic and avoids premature abstraction.

### Step 1: Choose Runtime and Structure

- Runtime: **Python**
- Web framework: **Flask** (or FastAPI; Flask is sufficient for the spike).

Flask chosen by default; minimal inline HTML strings will be used.

- Project layout for the spike:
  - `src/spike/main.py` – Flask app with routes.
  - `src/spike/requirements.txt` – Python dependencies.

No shared library or package structure is needed at this stage.

### Step 2: Create the GCP Project and Enable APIs

- Create a new GCP project. (A separate document will later describe the exact step-by-step procedure for project creation.)
- Enable the following APIs:
  - **Cloud Run Admin API** (or App Engine if chosen instead).
  - Cloud Run chosen explicitly for the spike, as it is Google’s currently promoted default.
  - **Cloud Build API** (for container deployments, if using Cloud Run).
  - **Google Drive API**.
- Optionally enable **Secret Manager** for storing the OAuth client secret.

### Step 3: Create OAuth Client (Web Application)

1. In the Google Cloud Console, create an **OAuth 2.0 Client ID** of type **Web application**.
2. Configure authorised redirect URIs for the spike, for example:
   - Local dev (optional): `http://localhost:8080/oauth2/callback`
   - Cloud Run: `https://<cloud-run-service-url>/oauth2/callback`

A single OAuth client should be used, with both Cloud Run and localhost redirect URIs, to minimise code size.

3. Note the **client ID** and **client secret**.

These values will be injected into the app via environment variables (or Secret Manager) as:

For the first spike implementation, environment variables are sufficient. Secret Manager integration is a target for a subsequent iteration, once the basic flow is confirmed working.

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

### Step 4: Configure Fixed IDs for the Spike

Define the following configuration, stored as environment variables for the service:

- `SOURCE_FILE_ID` – ID of a test file in a personal Drive account.
- `DESTINATION_FOLDER_ID` – ID of a folder in a Workspace Shared Drive.

During early testing, the developer manually ensures:

- The personal user used in the spike has access to `SOURCE_FILE_ID`.
- That same user has write access to `DESTINATION_FOLDER_ID`.

This allows the spike to rely only on the **user token** for the `files.copy` call.

Scope minimisation is not required for this spike; broad Drive scopes are acceptable.
For this spike, the OAuth request should use the unified full-access scope `https://www.googleapis.com/auth/drive`.

Access type online is enough.

Use `prompt=select_account` to force explicit account selection for clarity.

### Step 5: Implement Minimal Flask App

The Flask app will expose three main routes:

1. `GET /admin-spike`
   - Returns a simple HTML page confirming that the app is running.
   - Displays the URL of the `/user-spike` endpoint.
   - Optionally shows the configured IDs for debugging.

2. `GET /user-spike`
   - Shows a minimal page with a **“Start Migration (Spike)”** button.
   - When clicked, redirects to the Google OAuth consent screen using the configured client ID and requested scopes (e.g. `https://www.googleapis.com/auth/drive`).
   - The redirect includes a state parameter allowing the callback to know that this is a spike user-flow request.

3. `GET /oauth2/callback`
   - Receives the OAuth authorisation code.
   - Exchanges it for access (and optionally refresh) tokens.
   - Logs the user identity and basic token acquisition success.
   - Stores the access token temporarily (in memory or a simple session mechanism) sufficient for a single follow-up request.
   - Redirects the browser to a separate route (e.g. `/user-spike/copy-test`).

4. `GET /user-spike/copy-test`
   - Reads the access token stored by the callback.
   - Creates a Drive client bound to the user’s token.
   - Calls `files.copy` with `SOURCE_FILE_ID` and `DESTINATION_FOLDER_ID`.
   - Returns a simple HTML page showing success (new file ID) or failure (error message).

The exact division of logic within the callback route (exchange + copy) may need future discussion; for now a single-step handler is acceptable.

For the spike, token storage can be ephemeral (in-memory for the request lifecycle). Persistent storage is not required yet.

The token storage used here is deliberately minimal and ephemeral. In later iterations, this will be replaced with a structured persistence mechanism, and the same route split (callback vs. execution) will support queued jobs.

### Step 6: Local Testing

1. Run the Flask app locally on a port (e.g. 8080).
2. Update the OAuth client to allow the local redirect URI, or temporarily test only against the deployed Cloud Run endpoint.
3. Open `/admin-spike` and `/user-spike` in a browser, using two profiles to simulate admin and user.
4. Verify that the OAuth flow completes and the file is copied as expected.

Developer may simulate admin and user using two Chrome profiles or any equivalent browser setup.

### Step 7: Deploy to Cloud Run

1. Containerise the app with a minimal `Dockerfile` (Python base image + `pip install -r requirements.txt`).
2. Deploy via `gcloud run deploy`, configuring:
   - Environment variables (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SOURCE_FILE_ID`, `DESTINATION_FOLDER_ID`).
   - Region and service name.
3. Update the OAuth redirect URI to match the Cloud Run URL.
4. Repeat the spike test using the Cloud Run URL.

Local-first workflow is acceptable; deployment follows once local behaviour is correct.

### Step 8: Document Observations

After running the spike, the developer records:

- Exact behaviour of the OAuth flow (scopes, consent dialog, user identity).
- Behaviour of the `files.copy` call, including any special cases for Shared Drives.
- Error conditions encountered and how they surfaced.

If the spike succeeds, these observations will inform the next design steps. If it fails, this section and the main design overview must be updated to reflect the new constraints.

## Result and Lessons Learned

This spike was executed successfully on 2025-12-10 using a local Flask server on macOS.

**Confirmed capabilities**

- A web app using the Google Cloud OAuth client can:
  - Run locally with `http://localhost:8080/oauth2/callback` as redirect.
  - Perform a full 3-legged OAuth flow for a personal Google account.
- The returned credentials (with scopes including `https://www.googleapis.com/auth/drive`) can:
  - Call the Drive v3 API as the personal user.
  - Execute `files.copy` with `supportsAllDrives=true` from a personal file to a folder in a Workspace Shared Drive.
- Preconditions for a successful copy:
  - The OAuth user owns or can read `SOURCE_FILE_ID`.
  - The same user has write access to `DESTINATION_FOLDER_ID` in the Shared Drive.
  - The destination folder ID is copied exactly (no whitespace).

**Practical integration findings**

- OAuth consent and testing:
  - External apps requesting sensitive scopes require explicit **test users** on the OAuth consent screen.
  - During testing, users must go through the “Google hasn’t verified this app” warning and proceed via the “Advanced” link.
- Local development:
  - `OAUTHLIB_INSECURE_TRANSPORT=1` is required for non-HTTPS localhost redirects.
  - `OAUTHLIB_RELAX_TOKEN_SCOPE=1` is required to avoid failures when Google normalises or reorders scopes (e.g. adding `openid` and `userinfo.*`).
- Client library behaviour:
  - `include_granted_scopes` must be passed as the lowercase string `"true"`, not as a Python boolean, to satisfy Google’s parameter validation.
- Drive semantics:
  - Errors referring to `fileId` can in practice point to an invalid or inaccessible destination folder ID, not only the source file.
  - Shared Drive membership rules may prevent some personal accounts from being added as editors; the final architecture must accommodate this.

These observations confirm the core architectural assumption: a Workspace-hosted app can use a personal user’s OAuth token to perform Drive operations that cross from personal Drive into a Workspace Shared Drive, provided Drive-level permissions are correctly configured. They also highlight several edge conditions and configuration details that the main design must handle explicitly in later phases.

This architecture-spike.md alone is considered sufficient documentation for operating this spike; see spike/README.md for further details.
