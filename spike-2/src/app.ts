import { runPkceAuth } from "./auth";
import { moveFile, MoveFileOutcome } from "./drive";
import { manifest } from "./manifest";

function setStatus(message: string): void {
  const statusElement = document.getElementById("status");
  if (statusElement) {
    statusElement.textContent = message;
  }
}

function setJsonOutput(label: string, data: unknown): void {
  const output = document.getElementById("result");
  if (!output) return;

  const container = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = label;
  const pre = document.createElement("pre");
  pre.textContent = JSON.stringify(data, null, 2);

  container.appendChild(title);
  container.appendChild(pre);
  output.appendChild(container);
}

function clearOutput(): void {
  const output = document.getElementById("result");
  if (output) output.innerHTML = "";
}

function summariseOutcome(outcome: MoveFileOutcome): string {
  const d = outcome.diagnostics;
  const beforeParents = d.before.parents?.length ?? 0;
  const afterParents = d.after?.parents?.length;
  const reason = d.error?.reason;
  const msg = d.error?.message;
  const status = d.error?.status;
  return outcome.ok
    ? `OK. beforeParents=${beforeParents}, afterParents=${afterParents ?? "?"}`
    : `FAILED. http=${status ?? "?"}, reason=${reason ?? "?"}, message=${msg ?? "(no message)"}, beforeParents=${beforeParents}`;
}

async function handleStart(button: HTMLButtonElement): Promise<void> {
  button.disabled = true;
  setStatus("Authorising with Google...");

  try {
    const auth = await runPkceAuth();
    if (!auth.email) {
      throw new Error("Could not determine user email from the ID token.");
    }

    const destinationFolder = manifest.allowedUsers[auth.email];
    if (!destinationFolder) {
      throw new Error(
        `The manifest does not allow ${auth.email}. Update manifest.ts to add this user.`
      );
    }

    clearOutput();
    setStatus("Moving the test file into the Shared Drive...");
    const outcome = await moveFile(auth.accessToken, manifest.sourceFileId, destinationFolder);

    setStatus(summariseOutcome(outcome));

    setJsonOutput("Move diagnostics", outcome.diagnostics);

    if (outcome.ok) {
      const result = outcome.result;
      const output = document.getElementById("result");
      if (output) {
        const details = document.createElement("div");
        details.textContent = `File now at ID: ${result.id}`;
        output.appendChild(details);
        if (result.webViewLink) {
          const anchor = document.createElement("a");
          anchor.href = result.webViewLink;
          anchor.target = "_blank";
          anchor.rel = "noreferrer";
          anchor.textContent = "Open in Drive";
          output.appendChild(anchor);
        }
      }
    } else {
      // Also show a compact one-line error at the top.
      const err = outcome.diagnostics.error;
      if (err) {
        setJsonOutput("Drive HTTP error (parsed)", {
          status: err.status,
          statusText: err.statusText,
          reason: err.reason,
          message: err.message,
          url: err.url
        });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Error: ${message}`);
  } finally {
    button.disabled = false;
  }
}

function init(): void {
  const startButton = document.getElementById("start");
  if (!(startButton instanceof HTMLButtonElement)) {
    setStatus("Start button not found in the document.");
    return;
  }
  startButton.addEventListener("click", () => {
    handleStart(startButton);
  });
}

document.addEventListener("DOMContentLoaded", init);
