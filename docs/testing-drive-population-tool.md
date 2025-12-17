# Test tool: Google personal Drive population tool

## Purpose

This project needs a repeatable way to create a small but realistic test fixture in **Google personal (Gmail) Drive**:

- A folder subtree with mixed MIME types (Google Docs/Sheets/Slides + uploaded binaries).
- Files created by **multiple Google accounts** (at least 2, preferably 3).
- Fast regeneration: **several times per hour**.

The migration alpha (SPA) is intentionally destructive for the source tree. Recreating the fixture manually is too slow.

This document specifies a **Node.js CLI** tool that can (re)create the fixture quickly by authenticating as multiple accounts and creating the tree programmatically.

Non-goals:

- Preserving original creator/metadata across “copy” operations. (Drive copy resets creator.)
- Supporting Google Drive shortcuts (alpha does not support them).
- Production-grade secret management. This is developer/testing tooling.

## High-level approach

Implement a CLI that:

1. Performs **OAuth 2.0 Authorisation Code flow with PKCE** using a **loopback (localhost) redirect**.
2. Persists **refresh tokens** per account locally.
3. Uses those refresh tokens to obtain fresh access tokens non-interactively.
4. Creates (or deletes + recreates) a deterministic Drive folder tree with specified content.

Use `google-auth-library` for OAuth/token exchange, plus a small local HTTP server for the callback and explicit browser launching.

## Repository integration

Proposed layout (suggested; adjust to existing repo conventions):

```
tools/
  drive-populate/
    package.json
    src/
      cli.ts
      oauth.ts
      tokenStore.ts
      drive.ts
      fixture.ts
      logger.ts
    README.md
    tsconfig.json
docs/
  testing-drive-population-tool.md  (this file)
```

Implementation language: **TypeScript** (recommended), Node >= 18.

Distribution:

- `npm run drive:populate -- ...` (repo script), and/or
- `npx tsx tools/drive-populate/src/cli.ts ...` during development.

## CLI user experience

For the OAuth UI, the tool must be able to launch a specific browser and profile.
We will use Google Chrome, with a profile defined at the command line.
The tool shall run on macOS and should run equally on Linux.

### Commands

- `drive-populate auth --account <email> [--chrome-profile <name>|--chrome-profile-dir <dir>]`
  - Starts OAuth flow and stores refresh token. This will be run for multiple accounts.
- `drive-populate list-accounts`
  - Shows which accounts have stored credentials.
- `drive-populate create --spec <fixture.json> --root-name <name>`
  - Creates the fixture under a test root folder.  Prints the URL of the created root folder.
- `drive-populate delete --root-id <id>`
  - Deletes the fixture root (moves to trash or permanently deletes depending on flag).
- `drive-populate recreate --spec <fixture.json> --root-id <id>`
  - Convenience: delete + create.

### Typical workflow

1. One-time, per test account:
   - `drive-populate auth --account test.a@gmail.com --chrome-profile "DriveTestA"`
   - `drive-populate auth --account test.b@gmail.com --chrome-profile "DriveTestB"`
   - `drive-populate auth --account test.c@gmail.com --chrome-profile "DriveTestC"`

2. Rapid iteration:
   - `drive-populate recreate --spec fixtures/basic.json --root-name "MIGRATION-TEST"`
   - Run the migration tool against the created root.
   - Repeat.

## OAuth design (loopback + PKCE)

### Redirect strategy

Use a loopback redirect on 127.0.0.1:

- CLI opens a local HTTP server on an ephemeral port.
- Redirect URIs: `http://localhost:<port>/oauth2callback`

This avoids OOB flows and is the standard installed-app approach.

### Multi-account behaviour

We need tokens for **several Google accounts**. Strategy:

- Each account is authorised separately.
- Store refresh token per email.
- When executing fixture creation, the tool uses each account’s credentials to create that account’s portion of the fixture.

Important: the browser login session must not “leak” between accounts. Hence separate Chrome profiles.

### Browser launching and profile isolation (macOS)

We must be able to direct the auth URL into a specific browser profile to keep test accounts separate from normal browsing sessions.

Primary target: **Google Chrome profiles on macOS**.

Launch pattern:

- Use `child_process.spawn('open', ['-a', 'Google Chrome', '--args', '--profile-directory=<profile>', authUrl])`

Support both:

- `--chrome-profile` (friendly name mapped to a profile directory by a user-maintained mapping), or
- `--chrome-profile-dir` (explicit `--profile-directory` value like `Profile 2`).

Notes:

- Chrome profile directory names are usually `Default`, `Profile 1`, `Profile 2`, etc.
- A “profile name” displayed in Chrome UI is not necessarily the same as the directory name.

Fallback:

- If no Chrome profile option is given, open the default browser with `open <url>`.

Safari profile targeting is not required.

### Scopes

Minimal required scope depends on operations.

Recommended scopes for fixture creation:

- `https://www.googleapis.com/auth/drive` (simplest; broad)

If you want narrower scope later:

- `.../drive.file` is often insufficient for folder operations and cleanup.

### OAuth client type

Use a Google Cloud OAuth client for an “Installed app” / “Desktop app”.

Configuration provided via the environment, which may be stored in `$PROJECT_ROOT/.env`.

(Exact filename can vary; ensure it is in `.gitignore`.)

### Token exchange

Implementation outline:

- Generate PKCE verifier + challenge (S256).
- Create auth URL with:
  - `access_type=offline` (to obtain refresh token)
  - `prompt=consent` on first authorisation if needed
  - `login_hint=<email>` (best-effort account selection)
  - `code_challenge` / `code_challenge_method=S256`
- On callback, validate `state`, exchange code for tokens.

## Token storage

Store refresh tokens locally under `/tmp`.  This makes sure that they disappear latest at the next reboot.  This also means re-authorisation will be required after reboot; this is intentional.

Recommended location:

- macOS/Linux: `/tmp/$USER/gd-migrate-test/credentials/<email>.json`

File format (example):

```json
{
  "email": "test.a@gmail.com",
  "client_id": "...",
  "refresh_token": "1//...",
  "scopes": ["https://www.googleapis.com/auth/drive"],
  "created_at": "2025-12-15T00:00:00.000Z"
}
```

Security posture:

- This is developer tooling. Tokens are secrets.
- Ensure the credentials directory is `chmod 700` and files `chmod 600`.
- Add prominent warnings in the tool README.

Potential later improvement: use macOS Keychain / Passwords database.

## Drive operations

### Fixture root selection

The tool should support two modes:

1. **By name**: create a root folder under “My Drive” named `--root-name`.
2. **By ID**: operate under an existing root folder ID.

### Determinism

The created structure should be deterministic:

- Stable folder and file names
- Stable number and type of files
- Stable content templates (small text bodies)

The goal is reproducible tests.

### Mixed creators

To guarantee multiple creators:

- Partition the fixture spec into “chunks” assigned to accounts A/B/C.
- For each chunk, authenticate as that account and create those files.

Do not attempt to “copy” files to preserve creator; Drive copy resets creator.

### MIME types to cover

Include at least:

- Google Docs (`application/vnd.google-apps.document`)
- Google Sheets (`application/vnd.google-apps.spreadsheet`)
- Google Slides (`application/vnd.google-apps.presentation`)
- Uploaded PDF (`application/pdf`)
- Uploaded image (`image/png`)
- Uploaded binary (e.g. `application/zip` or `application/octet-stream`)
- Google Forms (`application/vnd.google-apps.form`)
  - Possibly harder; separate API

Optional edge cases (later):

- Shortcuts (not required)

### Content generation

- For Google Docs/Sheets/Slides: use simple placeholder content.
  - For Docs/Sheets/Slides, simplest is to create the file with correct mimeType and set a minimal body/title.
  - Do not aim to test rich formatting; the file contents are not important
- For binaries: keep tiny files in-repo under `tools/drive-populate/assets/`.
  - Example: a 1-page PDF, a small PNG, a tiny ZIP.

Google Forms handling: To ensure the fixture covers `application/vnd.google-apps.form`, the tool will initially skip automated creation of real Google Forms files, as the Forms API requires special OAuth scopes and is more complex than Docs/Sheets/Slides creation.

However, as Forms coverage is required for testing, the workflow will copy a user-generated Form and corresponding Sheet.  For that the fixture JSON (see below) needs to have the option of copying given files, identified by their IDs.

## Fixture specification format

Use a JSON spec so that fixtures can be versioned and reviewed.

Example `fixtures/basic.json`:

```json
{
  "accounts": [
    { "email": "test.a@gmail.com", "label": "A" },
    { "email": "test.b@gmail.com", "label": "B" },
    { "email": "test.c@gmail.com", "label": "C" }
  ],
  "root": {
    "name": "MIGRATION-TEST",
    "children": [
      {
        "type": "application/vnd.google-apps.folder",
        "name": "Mixed-Ownership-Folder",
        "children": [
          {
            "type": "application/vnd.google-apps.document",
            "name": "doc-by-A",
            "owner": "A"
          },
          {
            "type": "application/vnd.google-apps.spreadsheet",
            "name": "sheet-by-B",
            "owner": "B"
          },
          {
            "type": "application/vnd.google-apps.folder",
            "name": "Nested-Mixed",
            "children": [
              {
                "type": "application/vnd.google-apps.presentation",
                "name": "slides-by-C",
                "owner": "C"
              },
              {
                "type": "application/pdf",
                "name": "pdf-by-A",
                "owner": "A",
                "asset": "tiny.pdf"
              },
              {
                "type": "image/png",
                "name": "png-by-B",
                "owner": "B",
                "asset": "tiny.png"
              }
            ]
          }
        ]
      },
      {
        "type": "application/vnd.google-apps.folder",
        "name": "Forms-Template-Copy",
        "owner": "A",
        "children": [
          {
            "type": "copy",
            "name": "form-copy-1-form",
            "owner": "A",
            "sourceId": "<drive-file-id-of-template-form>"
          },
          {
            "type": "copy",
            "name": "form-copy-1-sheet",
            "owner": "A",
            "sourceId": "<drive-file-id-of-template-sheet>"
          }
        ]
      }
    ]
  }
}
```

Rules:

- type is normally the Drive MIME type to create. Folder nodes use application/vnd.google-apps.folder.
- type: "copy" copies an existing Drive file and requires sourceId.
- Each node may specify an owner label (A/B/C). If omitted, the owner is inherited from the nearest ancestor that specifies one.
- Files within the same folder may intentionally have different owners.
- For most application/vnd.google-apps.* MIME types
  - Docs/Sheets/Slides creation is just Drive files.create with that MIME type;
  - specific code is mainly needed for content and for Forms (later)
- Uploaded/binary nodes specify asset (path relative to the tool’s assets directory) and use an appropriate MIME type in type (e.g. application/pdf, image/png).

Please note that copying a Form does not necessarily preserve all linkages as expected, and that the copied response destination may not be wired the way we want.  This needs to be checked and verified during implementation.  We need a Form object in the tree, but at this writing we don't know what is the best way to create it.

## Implementation notes

### Libraries

- `google-auth-library` for OAuth and token exchange.
- `googleapis` (Drive v3 client) or direct REST calls with `fetch`.
  - Either is fine; for speed, `googleapis` is common.

### Local callback server

- Use Node `http` module.
- Bind to `127.0.0.1` (and `::1`) only.  Whatever is simplest for `localhost`.
- Choose port 0 (ephemeral) and read back the actual port.
- Handle exactly one request and then close.
- Validate `state`.

### Token renewal

- Use refresh token to obtain access token for each account before operations.
- Cache access token + expiry in memory for the duration of a run.

### Error handling

- Clear error messages: missing credentials for account, consent required, permission issues.
- If Drive returns 401, retry once after refreshing token.

### Rate limiting

Fixture size is small. Basic exponential backoff on 429/5xx is enough.

### Logging

- Default: concise.
- `--verbose`: print request IDs, created file IDs.

### Cleanup mode

Deletion strategy: Permanently delete, if easy.  No need to preserve in trash.

## Security and hygiene

- Do not commit OAuth client secrets or refresh tokens.
- Add `.gitignore` entries for:
  - `.env`
  - local credentials directory (if it resides under repo)
  - use variables `TEST_TOOL_GOOGLE_OAUTH_CLIENT_ID` and `TEST_TOOL_GOOGLE_OAUTH_CLIENT_SECRET`

- Document how to revoke tokens:
  - Google Account → Security → “Third-party access” / “Sign in with Google” → remove the app.

## Acceptance criteria (for this tool)

- One-time auth per account.
- Recreate a fixture in under ~30 seconds for small trees.
- Fixture contains mixed MIME types and mixed creators.
- Works on macOS with Chrome profile isolation.
- Minimal dependencies; readable code.

## Open questions (decide during implementation)

- Whether to depend on `googleapis` vs direct REST.
- Whether `--chrome-profile` should be a mapping file (e.g. `profiles.json`) or just `--chrome-profile-dir`.
- Whether root folder creation should be done by account A only, or each account creates its subtree under an existing root.

```
