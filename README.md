

# Google Drive Personal → Workspace Multi-Owner Migration Tool

(google-drive-personal-to-workspace-multiowner-migration)

**Status:** Planning → Early Alpha
**Purpose:** Provide a documented, open-source workflow for migrating **multi-owner** content
from **personal Google Drives** into a **single Google Workspace Shared Drive**.
This project defines a clean migration architecture before code is implemented.

## Overview

Organisations often accumulate important material in shared personal Google Drive folders,
sometimes created by several contributors over many years.
Google provides no supported workflow for consolidating such mixed-ownership content into Workspace Shared Drives,
and ownership transfer from personal → Workspace is technically prohibited.

Existing open-source tools typically assume a **single owner**, operate only within Workspace domains,
or address limited subsets of this problem.
Commercial tools exist, but none offer a transparent, open-source, multi-owner migration pipeline.

This project aims to fill that gap with a **clear, auditable**, and **documented** migration workflow.

## Key Concepts (Planned)

### 1. Admin-driven folder reconstruction
A Workspace admin performs one enumeration pass over the shared personal folder tree:
- Builds a matching hierarchy inside the chosen Shared Drive.
- Generates a **manifest** recording every file, its owner, and its target folder.

### 2. Per-owner migration scripts
Each original personal account migrates **only the files they own**, using the generated manifest:
- OAuth login as the original owner.
- Copy each file into the pre-created Shared Drive folders.
- Skip files owned by others automatically.
- Produce a detailed log for verification.

This reflects Google’s constraints: ownership transfer is disallowed; copying is permitted.

### 3. Metadata-aware behaviour
Where Google allows:
- File structure, names, and MIME types preserved.
- Creator attribution retained in Workspace.
- Google Docs remain native formats.

Known unavoidable losses (revision history, original IDs, some timestamps) are documented and not concealed.

## Why This Project Exists

There are many scripts for copying a single user’s folders to a Shared Drive,
but — as far as I know — none provide a structured, multi-owner workflow with clear
separation of responsibilities between admin and former owners.
This project attempts a disciplined, transparent approach rather than another ad‑hoc script.

It may or may not reach beta maturity; usefulness will determine development.

## Current Stage

- Architecture design in progress; see [docs/design-overview.md] for details.
- Documentation drafted before implementation.
- Alpha-level behaviour planned for small-scale trials.

## Contributing

Feedback on design, UX clarity, and correctness is welcome at this early stage.

## License

TBD (likely The Unlicense).
