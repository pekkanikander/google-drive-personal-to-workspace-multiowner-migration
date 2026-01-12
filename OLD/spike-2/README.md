# Architecture Spike 2 (browser-based user tool)

Throwaway spike that proves a static SPA can:

1. Run entirely in the browser.
2. Use Google Identity Services OAuth 2.0 (code + PKCE) to authenticate a personal Gmail user.
3. Use the returned access token to call Drive v3 `files.update` (with `addParents`/`removeParents`) to move the file into a Shared Drive folder.

## Prerequisites

- Node.js 18+
- A Google Cloud OAuth client (type: Web application) with:
  - Authorised JavaScript origin: `http://localhost:8081`
  - Authorised redirect URI: `http://localhost:8081/callback.html`
- A test `SOURCE_FILE_ID` from a personal Drive account.
- A destination folder ID inside a Workspace Shared Drive where the same personal Gmail account has Writer access.

## Setup

1. Install dependencies:
   ```sh
   cd spike-2
   npm install
   ```
2. Edit `src/config.ts` and `src/manifest.ts`:
   - Set the OAuth client ID / redirect URI (keep the redirect while testing locally).
   - Set `sourceFileId` and map the Gmail address you will test with to the destination folder ID.
3. Provide the client secret at build time (only for this spike) by exporting `SPIKE2_CLIENT_SECRET`:
   ```sh
   export SPIKE2_CLIENT_SECRET="your_client_secret"
   ```
4. Build the SPA bundle:
   ```sh
   npm run build
   ```

## Run locally

Serve the static files from `public/` on the same origin configured in the OAuth client. For example:

```sh
cd public
python3 -m http.server 8081
```

Then open `http://localhost:8081/` in a browser, click **Start spike**, approve the Google consent dialog, and watch the status text for success/failure.

If you need live rebuilds, run `npm run watch` (keep `SPIKE2_CLIENT_SECRET` exported in that shell) and refresh the browser after recompilation.

## Notes

- This spike intentionally keeps the manifest inline and applies no additional security checks beyond Drive ACLs.
- There is no persistence, retry logic, or batching; it moves a single file described by the manifest.
- Closing the OAuth popup before consent will surface an error and you can try again.
