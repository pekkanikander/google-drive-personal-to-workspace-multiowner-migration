# Publicity Plan

This project solves a recurring and poorly addressed need: migrating multi‑owner content from personal Google Drive folders into Google Workspace Shared Drives. Awareness and discoverability are essential for usefulness. The goal of this publicity plan is to ensure that potential users—admins, IT staff, and technically capable volunteers—can find the tool when searching for migration solutions.

**Alpha constraints to disclose clearly:** move-only, SPA-only (static hosting), Sheets as coordination/log store, manual temporary Shared Drive Manager grants, no cross-device resume, best-effort “fail fast” behaviour on Sheets quotas.

## 1. Target audience

- Google Workspace administrators.
- Non‑profit organisations transitioning from personal Google accounts to Workspace.
- Small businesses migrating legacy shared folders.
- IT consultants who perform Drive clean‑ups or Workspace deployments.
- Open‑source contributors interested in Google API tooling.

## 2. Core value propositions (to communicate widely)

- Open-source and free.
- Handles multi-owner, multi-account legacy structures.
- Does not require users to manually transfer ownership.
- Minimises user friction through OAuth-based self-service migration.
- Designed for clarity, correctness, and transparent behaviour.
- Explicitly addresses known problems in existing tools (e.g., unstable transfer ownership dialogs, missing multi-user workflows).

## 3. Channels for initial outreach (high-signal communities)

### 3.1 GitHub presence
- Clear README with diagrams, screenshots, and limitations.
- GitHub Topics:
  - `google-drive`
  - `drive-api`
  - `google-workspace`
  - `migration-tool`
  - `data-migration`
  - `automation`
- A curated list contribution to:
  - *Awesome Google Workspace*
  - *Awesome Google Cloud*
  - *Awesome Sysadmin*

### 3.2 Stack Overflow
Common search terms already mapped during earlier research:
- “transfer ownership google drive API”
- “migrate personal drive to shared drive”
- “google drive multi owner migration”
- “copy Google Drive folder structure API”
- “Google Workspace shared drive migration”

https://stackoverflow.com/questions/65226499/move-a-folder-into-a-team-drive-using-google-drive-api

Actions:
- Prepare code-backed answers (not self-promotional) explaining concepts that the tool implements (folder tree copying, Drive permission patterns, multi-user migration pitfalls).
- Where appropriate, include a link to the GitHub repo as a related open-source solution.

### 3.3 Google Issue Tracker / Google Workspace Admin Forum
- Post an explanation of the tool in threads where administrators request bulk migration options.
- Emphasise that it complements Google's own “Transfer ownership” functionality and particularly fills the multi‑owner gap.

### 3.4 Reddit communities
Relevant subreddits:
- r/google
- r/googlecloud
- r/sysadmin
- r/gsuite (if still active)
- r/nonprofit
- r/selfhosted (for open-source interest)

Post content should:
- Highlight the recurring migration pain.
- Describe the architectural approach.
- Emphasise safety and transparency.
- Invite testers for beta versions.

### 3.5 Mastodon / Fediverse
- Publish concise technical posts tagged with:
  - #GoogleDrive
  - #Workspace
  - #OpenSource
  - #SysAdmin
  - #MigrationTools

Focus on reaching IT professionals and open-source communities.

## 4. SEO / discoverability optimisation

TODO: Error message teamDrivesFolderMoveInNotSupported

### 4.1 GitHub README keywords
Include structured phrases:
- “migrate personal Google Drive to Workspace”
- “multi-owner Drive migration”
- “bulk copy Google Drive folder tree”
- “Google Drive Shared Drive migration tool”

### 4.2 Create minimal documentation pages
A GitHub Pages site (auto-generated from docs/) improves indexing by search engines.

Include:
- clear problem statement,
- architecture overview,
- limitations,
- comparison to existing options (neutral, factual).

### 4.3 Publish a short technical article
Platforms:
- Medium (Google Workspace tags)
- dev.to
Produce an article describing:
- why multi-owner migration is hard,
- pitfalls of Drive APIs,
- how the tool solves these,
- link to repo.

## 5. Community engagement (post‑beta)

After early adopters begin using the tool:

- Create GitHub Discussions for Q&A.
- Add a “Migration recipes” section contributed by users.
- Invite collaborators for:
  - Workspace App UX improvements,
  - language support,
  - deployment templates (Cloud Run, Docker),
  - packaging for Windows/macOS/Linux.

## 6. Long-term visibility

- Submit to Google Cloud Marketplace if licensing allows.
- Add to open-source migration tool lists.
- Present in tech meetups or Workspace admin groups.
- Encourage blog posts from early adopters describing their migration experiences.

---

This plan should be revised once the tool reaches beta maturity and we have insights from early testers.
