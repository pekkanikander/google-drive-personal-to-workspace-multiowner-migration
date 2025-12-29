# AGENTS.md

## Mission

Build a **plain TypeScript** two **SPA** system that migrates mixed-owner content
from a shared **personal Google Drive** folder tree
into a **single Workspace Shared Drive**, using an auditable, resumable workflow defined in `docs/`.

Optimise for correctness, idempotency, and clear operator UX. Avoid scope creep.

## Authoritative docs

Treat these as the source of truth; keep them consistent with code:
- `README.md`
- `docs/design-overview.md`
- `docs/design-two-spas.md`
- `docs/risks.md`

If implemented behaviour changes, update docs in the same change.

## Hard constraints
- No impersonation: each personal owner must OAuth as themselves.
- No ownership transfer.
- Two-SPA model is the default (Admin SPA + User SPA), coordination state stored in Drive files.
- Alpha scope excludes shortcuts and indirect references.
- Shared Drives require a strict tree: detect multi-parent files; exclude from automatic migration in alpha.

## Transfer modes
Job chooses exactly one mode:
1. Move (default): keep ID; `files.update` with `addParents`/`removeParents`.
2. Copy: new ID; `files.copy`; must record destination ID to avoid duplicates.
3. Move + Restore Copy: discouraged; move then copy back.

First alpha implements only mode #1.

## Idempotency rules (must follow)
- **Move**: always `GET` current parents first; if already under expected destination parent, mark done. Otherwise patch with fresh `removeParents`. Never reuse stale parents.
- **Copy / restore copy**: record `dest_file_id` (and `restore_copy_id`) in progress state; skip if already recorded/verified. No API-level idempotency.

## State model (alpha)
The manifest on the Drive is the coordination layer (in job folder under destination Shared Drive), e.g.:
- `<job-name> manifest` Google Sheet,
  - Manifest sheet (admin-written, user-updated)
  - Log sheet (user-written, admin-read; resumable)

Minimise shared mutable state across users; and append-only logs.

## Security / permissions (alpha posture)
Alpha may grant participating users temporary Shared Drive Manager access; default to revoke after completion.
Do not silently broaden permissions beyond what the docs describe.

## Do-not-touch files
- Do not modify `.env`.
- Do not modify the `pnr.json` fixture (wherever it lives in the repo).

## Repo/workflow expectations
- Small, targeted changes. No drive-by refactors.
- Don’t add dependencies unless explicitly instructed.
- Add tests for pure logic (manifest schema, task filtering by owner, idempotency decisions, progress transitions).

## Tooling (current)

Package manager: `npm`.

Do not invent/rename scripts unless asked.
When you need to run something, prefer:
- `npm install`
- `npm run <script>`

## Change protocol
1. Restate goal in one sentence.
2. Identify which doc sections are impacted (if any).
3. Implement minimal code change.
4. Ensure resumability + idempotency invariants still hold.
5. Update docs if behaviour changed.
6. Summarise what changed + what you ran (or why nothing was run).

## Ask before acting when
- Changing manifest/progress schema or backwards compatibility.

## Do never
- Expand scope (shortcuts, shared-with-me items, Forms edge cases beyond current plan).
- Change permission model (roles/ACL strategy, where state files live).
- Introduce any backend/cloud resources beyond static hosting + OAuth.
- Modify `.env` or `pnr.json` (normally forbidden).
