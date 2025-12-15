# MVP alpha scaffold for the two-SPA, move-only workflow.

What’s here now:
- Minimal build setup (`package.json`, `tsconfig.json`, `scripts/build.mjs`) using esbuild for two bundles (`admin/index.ts`, `user/index.ts`) emitted to `public/dist/`.
- Shared TypeScript helpers in `src/shared/` for auth, config parsing, Sheets/Drive calls, manifest types, and a tiny IndexedDB journal.
- Placeholder entrypoints in `src/admin/index.ts` and `src/user/index.ts` (no UI yet).

What’s next:
- Implement the Admin SPA shell to collect source/destination URLs (and client ID if desired), enumerate the source tree, mirror folders, and write `JobInfo` + `Manifest` sheets.
- Implement the User SPA shell to parse the job link, OAuth, validate schema, claim batches, move files idempotently, and log to Sheets.

Build:
```sh
cd mvp-alpha
npm install
npm run build   # emits public/dist/admin.js and public/dist/user.js
npm run check   # type-check only
```

Serve static files for local testing (example):
```sh
npx http-server public -p 8081
```

Note: OAuth client origins should include `http://localhost:8081` and the deployed host (e.g. `https://google-drive-migration.pnr.iki.fi`). No secrets are stored in the repo.
