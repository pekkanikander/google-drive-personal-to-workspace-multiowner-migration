# Risk Log

This document tracks major risks identified for the Google Drive Personal → Workspace Multi-Owner Migration Tool.
Each risk entry lists the driver, potential impact, current status, and mitigation or next action.

| ID | Risk | Impact | Status | Mitigation / Next Action |
| --- | --- | --- | --- | --- |
| R1 | **Service account enumeration fails** — the Workspace service account cannot see or classify all items in a shared personal Drive tree. | Blocks manifest generation and admin planning. | Closed | Execute Architecture Spike 3 to verify `files.list` coverage, owners, shortcuts, and permissions. Adjust design if gaps emerge. |
| R2 | **Admin workflow too manual** — SPA approach requires excessive manual sharing/link distribution, making real-world migrations impractical. | Limits adoption; admins may abandon the tool. | Open | Define the minimal admin workflow, document it clearly, and validate it in an additional Workspace tenant with fresh settings. |
| R3 | **Temporary permission automation unavailable** — system cannot grant/revoke per-user editor access on destination folders programmatically. | Admin workload remains high; risk of misconfigured permissions. | Open | Investigate Drive API support for service-account-driven permission grants/removals; spike automation or design a safe manual fallback. |
| R4 | **Manifest storage/concurrency issues** — keeping manifests inside Google Drive files leads to corruption or race conditions when multiple users run concurrently. | Migration status becomes unreliable; troubleshooting escalates. | Open | Prototype manifest persistence using a Drive-native format (Sheets/Docs/JSON), test concurrent updates, and define locking/idempotency rules. |
| R5 | **Copy-mode semantics unverified** — “move + restore copy” and “copy only” behaviours may not match documented expectations (ACL inheritance, quotas, timestamps). | Users may lose access or see unexpected duplicates. | Pending | Plan later spike to exercise both copy modes once move mode is stable; update documentation accordingly. |
| R6 | **OAuth consent flow limits** — personal Gmail users face sensitive-scope warnings or test-user limits, blocking large migrations. | Contributors cannot authorise the app. | Open | Pursue Google verification or ensure the app stays within test-user quotas; document consent expectations for admins/users. |
| R7 | **Drive ownership quirks** — manual Drive UI operations can change ownership and break repeatability (e.g., moving files back resets owners). | Retries fail; migration state becomes inconsistent. | Open | Document constraints for admins (“do not move files manually during migration”), detect owner changes in manifests, and plan remediation steps. |
| R8 | **Workspace policy diversity** — other Workspace tenants (especially secure defaults) may block SPA/static hosting or service-account sharing. | Deployments fail outside our test tenant. | Open | Deploy spikes to additional Workspace environments (esp. newly created Nonprofit tenants) and note required org policy adjustments. |

_This log should be updated whenever a risk is mitigated, accepted, or new risks surface._
