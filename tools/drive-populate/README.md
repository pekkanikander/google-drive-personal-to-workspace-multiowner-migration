## Drive population testing CLI

Creates and rebuilds small mixed-ownership fixtures in personal Google Drive for migration testing.

This tool has been build by Codex / ChatGPT-5.2 without a human reviewing all the code.  There may be LLM generated bugs.

- **Commands**
  - `auth --account <email> [--chrome-profile-dir <dir>]` — run PKCE + loopback OAuth, store refresh token in `/tmp/$USER/gd-migrate-test/credentials/<email>.json`.
  - `list-accounts` — list stored credentials.
  - `populate --spec <fixtures/basic.json> --root-id <id> [--verbose]` — populate an existing, pre-shared root folder using the spec.
  - `clean --root-id <id> [--account <email>]` — delete all contents under the root (root itself stays).

- **Env vars**
  - `TEST_TOOL_GOOGLE_OAUTH_CLIENT_ID` (required)
  - `TEST_TOOL_GOOGLE_OAUTH_CLIENT_SECRET` (required)

- **Scopes**
  - `https://www.googleapis.com/auth/drive`
  - `https://www.googleapis.com/auth/forms.body`
  - `https://www.googleapis.com/auth/spreadsheets`

- **Browser launch**
  - macOS/Linux: uses `open -a "Google Chrome" --args --profile-directory=<dir> <url>` when `--chrome-profile-dir` is provided.
  - Otherwise falls back to `open <url>` (default browser).

- **Run**
  ```sh
  cd tools/drive-populate
  npm install
  npm run drive:populate -- --help   # builds to dist/ then runs
  ```

- **Output discipline**
  - Logs go to stderr.
  - Scriptable outputs (e.g., IDs) go to stdout only.

## Forms limitation

Copying a Google Form does **not** carry over its response destination. The Google Forms REST API does not currently allow setting or changing the response spreadsheet programmatically. The tool will:
- Copy the Form and the Sheet.
- Check `linkedSheetId` on the copied Form.
- If it is missing or different from `linkResponseSheet` in the spec, log a warning and continue.

You must manually link the copied Form to the desired Sheet in the Forms UI (open the Form → Responses → Sheets icon → select existing spreadsheet).

Tokens live under `/tmp/$USER/gd-migrate-test/credentials` with 700/600 permissions; they disappear on reboot. Remove a token file to force re-auth.
