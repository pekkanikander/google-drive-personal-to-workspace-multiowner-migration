# Architecture Spike 3 (admin-side enumeration SPA)

Throwaway SPA that authenticates the admin in-browser (GIS token client), enumerates a shared personal Drive root, and emits a CSV manifest (or writes a Google Sheet). No backend, no service account.

## Setup

1. Install deps:
   ```sh
   cd spike-3
   npm install
   ```
2. Edit `src/config.ts`:
   - `clientId` (OAuth Web client)
   - `sourceRootFolderId` (shared personal root)
   - `destinationManifestFolderId` (destination Shared Drive job folder where the CSV can be written)
   - `manifestFilename` if you want a different name

## Build

```sh
npm run build
```

## Run locally

Serve `public/` on the same origin configured in the OAuth client (e.g. `http://localhost:8081`):

```sh
cd public
python3 -m http.server 8081
```

Open the page, click **Authenticate**, then **Enumerate**. Download the CSV, try **Write CSV to Drive**, or **Write Google Sheet** to create a Sheets file in the configured destination folder. Multi-parent and shortcut items are only logged; no special handling beyond inclusion in the outputs.

## Notes / gotchas

- Google Sheets API must be enabled on the OAuth project to use **Write Google Sheet**. Without it, the Sheets write call fails with `PERMISSION_DENIED` and a `service=sheets.googleapis.com` activation URL. Enable the API in Cloud Console and retry.
- Once the API was enabled, the spike succeeded end-to-end (auth → enumerate → CSV upload → Sheets write) from localhost and Github Pages with no further issues.
