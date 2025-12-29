import { TokenClient, fetchUserEmail } from "../shared/auth";
import { buildRuntimeConfig } from "../shared/config";
import { parseJobLink } from "../shared/link";
import { SheetsClient, MANIFEST_HEADERS, parseJobInfo } from "../shared/sheets";

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

async function main() {
  const status = $("status");
  const btn = $("btn-start") as HTMLButtonElement;

  let config;
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

      setStatus(
        status,
        `Ready.\nJob: ${jobInfo.job_label}\nMode: ${jobInfo.transfer_mode}\nSheet: ${sheetId}\nSigned in as ${email}`,
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
