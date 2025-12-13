

# Google Drive Personal → Workspace Multi-Owner Migration Tool

(google-drive-personal-to-workspace-multiowner-migration)

**Status:** Planning → Early Alpha

**Purpose:** Provide a documented, open-source tool and workflow for migrating **multi-owner** content
from **personal Google Drive** into a **single Google Workspace Shared Drive**.

This project defines a clean migration architecture, with an alpha release planned soon.

## Overview

Organisations often accumulate important material in shared personal Google Drive folders,
sometimes created by several contributors over many years.
Google provides no supported workflow for consolidating such
mixed-ownership content into Workspace Shared Drives.

Existing open-source tools typically assume a **single owner**, operate only within Workspace domains,
or address limited subsets of this problem.
Commercial tools exist, but none offer a transparent, open-source, multi-owner migration pipeline.

This project aims to fill that gap with a **clear, auditable**, and **documented** migration workflow.

## Key Concepts (Planned)

### 1. Admin-driven folder reconstruction
A Workspace admin uses the tool to perform an enumeration pass over the shared personal folder tree:
- Building a matching folder hierarchy inside the chosen Shared Drive.
- Generating a **manifest**, recording every source file, its owner, and its target folder.

### 2. Per-owner migration user interface
Each original personal account migrates **only the files they own**, using the generated manifest:
- OAuth login as the original owner.
- Execute the selected transfer mode (move or copy) into the pre-created Shared Drive folder(s).
- Skip files owned by others automatically.
- Produce a detailed log for verification.

This reflects Google’s constraints: ownership transfer is disallowed; copying and moving is permitted.

### 3. Metadata-aware behaviour
Where Google allows:
- File ID preserved, if so desired and allowed by target Workspace policy.
- File structure, names, and MIME types preserved.
- Creator attribution retained in the Workspace.
- Google Docs remain native formats.

Known unavoidable losses (revision history, original IDs, some timestamps) are documented and not concealed.

## Why This Project Exists

There are many scripts for copying a single user’s folders to a Shared Drive,
but — as far as we know — none provide a structured, multi-owner workflow with clear
separation of responsibilities between admin and former owners.
This project attempts a disciplined, transparent approach rather than another ad‑hoc script.

## Transfer Modes (Current Plan)

The migration engine supports three per-job modes:

1. **Move** *(default)* — files are moved from personal Drive into the Shared Drive while keeping the same file ID (Drive move semantics).
2. **Move + Restore Copy** — files are moved (same ID now lives in the Shared Drive), then a same-name copy is recreated at the original location so collaborators still see a file there (the restored file gets a new ID).
3. **Copy** — source files stay in place (original ID untouched) and a same-name copy with a new ID is created in the Shared Drive.

Move-based modes therefore keep historical links/bookmarks working because the underlying ID is preserved. The “restore copy” option merely replenishes the source location with a new-file-ID twin so collaborators are not surprised, whereas the pure copy mode leaves the original in place and only adds a new ID in the Shared Drive.

Only Workspace-safe operations are used; ownership transfers remain disallowed.

This tool may or may not reach beta maturity; usefulness will determine development.

## Current Stage

- Architecture design in progress; see [Design overview](docs/design-overview.md) for details.
- Documentation drafted before implementation.
- Alpha-level behaviour planned for small-scale trials.

## Contributing

Feedback on design, UX clarity, and correctness is welcome at this early stage.

## License

The Unlicense.
