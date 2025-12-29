import { TokenClient, fetchUserEmail } from "../shared/auth";
import { buildRuntimeConfig } from "../shared/config";
import { DriveClient } from "../shared/drive";
import { parseJobLink } from "../shared/link";
import { SheetsClient, MANIFEST_HEADERS, parseJobInfo, parseManifest } from "../shared/sheets";
import { buildManifestEntries, filterEntriesForOwner, PreparedEntry } from "./manifest";
import { createRelativePathResolver } from "./paths";

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

function setStatus(el: HTMLElement, msg: string, type: "info" | "error" | "success" = "info") {
  el.textContent = msg;
  el.classList.remove("error", "success");
  if (type === "error") el.classList.add("error");
  if (type === "success") el.classList.add("success");
}

function setText(id: string, value: string) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setListVisible(visible: boolean) {
  const el = document.getElementById("file-list-container");
  if (!el) return;
  el.classList.toggle("hidden", !visible);
}

function clearFileList() {
  const list = document.getElementById("file-list") as HTMLOListElement | null;
  if (list) list.innerHTML = "";
  setText("file-list-note", "");
}

function setStats(total: number, moved: number) {
  setText("stat-total", String(total));
  setText("stat-moved", String(moved));
}

function renderFileList(entries: PreparedEntry[], drive: DriveClient, sourceRootId: string) {
  clearFileList();
  if (entries.length === 0) {
    setListVisible(false);
    return;
  }
  setListVisible(true);
  const list = document.getElementById("file-list") as HTMLOListElement | null;
  if (!list) return;

  const maxItems = 200;
  const shown = entries.slice(0, maxItems);
  const countNote =
    entries.length > maxItems
      ? `Showing first ${maxItems} of ${entries.length} files.`
      : `Showing ${entries.length} files.`;
  const note = `Paths shown relative to the source root. ${countNote}`;
  setText("file-list-note", note);

  const resolver = createRelativePathResolver(drive, sourceRootId);
  shown.forEach((entry) => {
    const parentId = entry.parents[0] ?? "";
    const li = document.createElement("li");
    li.textContent = entry.row.name;
    list.appendChild(li);
    void resolver
      .resolveFilePath(parentId, entry.row.name)
      .then((path) => {
        li.textContent = path;
      })
      .catch(() => {
        li.textContent = entry.row.name;
      });
  });
}

async function main() {
  const status = $("status");
  const btn = $("btn-start") as HTMLButtonElement;

  let config;
  let preparedEntries: PreparedEntry[] = [];
  try {
    const parsed = parseJobLink(window.location.hash);
    config = buildRuntimeConfig({ linkFragment: window.location.hash });
    if (!parsed.sheetId || !parsed.jobToken || !parsed.oauthClientId) {
      throw new Error("Link missing required parameters (sheet/token/clientId).");
    }
    setStatus(status, `Link OK. Sheet: ${parsed.sheetId}`);
  } catch (err: any) {
    setStatus(status, `Invalid or missing link parameters: ${err?.message || err}`, "error");
    btn.disabled = true;
    return;
  }

  btn.onclick = async () => {
    btn.disabled = true;
    setStatus(status, "Signing in...");
    try {
      if (!(window as any).google) throw new Error("Google Identity Services script not loaded.");
      const tokenClient = new TokenClient({
        clientId: config.oauthClientId,
        scope: "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email",
      });
      const token = await tokenClient.getToken();
      const email = await fetchUserEmail(token.accessToken);
      setStatus(status, `Signed in as ${email}. Validating job...`);

      const sheetId = config.sheetId!;
      const jobToken = config.jobToken!;
      const sheets = new SheetsClient(token.accessToken, sheetId);
      const jobRows = await sheets.getValues("JobInfo!A1:B50");
      const tokenRow = jobRows.find((r) => r[0] === "job_token");
      if (!tokenRow || tokenRow[1] !== jobToken) {
        throw new Error("Job token mismatch or missing in JobInfo sheet.");
      }
      const jobInfo = parseJobInfo(jobRows);
      const manifestHeader = await sheets.getValues("Manifest!1:1");
      const header = manifestHeader[0] ?? [];
      const headerMismatch =
        header.length < MANIFEST_HEADERS.length || MANIFEST_HEADERS.some((v, i) => header[i] !== v);
      if (headerMismatch) {
        throw new Error("Manifest header mismatch. Please ask admin to regenerate the manifest.");
      }

      const manifestValues = await sheets.getValues("Manifest");
      const manifestRows = parseManifest(manifestValues);
      const entries = buildManifestEntries(manifestRows);
      const { owned, eligible, multiOwnerCount } = filterEntriesForOwner(entries, email);

      if (owned.length === 0) {
        setStats(0, 0);
        setListVisible(false);
        setStatus(
          status,
          `Signed in as ${email}.\nNo files in this manifest are owned by you, so you are not needed for this job.`,
          "success",
        );
        return;
      }

      preparedEntries = eligible;
      setStats(preparedEntries.length, 0);
      const drive = new DriveClient(token.accessToken);
      renderFileList(preparedEntries, drive, jobInfo.source_root_id);

      setStatus(
        status,
        `Ready.\nJob: ${jobInfo.job_label}\nMode: ${jobInfo.transfer_mode}\nSheet: ${sheetId}\nSigned in as ${email}\nYour files: ${owned.length}\nEligible (single-owner): ${eligible.length}\nSkipped (multi-owner): ${multiOwnerCount}\nMoved: 0 (placeholder)`,
        "success",
      );
    } catch (err: any) {
      setStatus(status, `Error: ${err?.message || err}`, "error");
      btn.disabled = false;
    }
  };
}

main().catch((err) => {
  console.error(err);
  alert(`Fatal error: ${err?.message || err}`);
});
