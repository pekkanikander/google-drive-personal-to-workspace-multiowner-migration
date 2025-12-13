import { runPkceAuth } from "./auth";
import { moveFile } from "./drive";
import { manifest } from "./manifest";

function setStatus(message: string): void {
  const statusElement = document.getElementById("status");
  if (statusElement) {
    statusElement.textContent = message;
  }
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

    setStatus("Moving the test file into the Shared Drive...");
    const result = await moveFile(auth.accessToken, manifest.sourceFileId, destinationFolder);

    const link = result.webViewLink ? `View file` : "";
    setStatus(
      `Completed. Moved file to ${result.name ?? result.id} (${link || result.id}).`
    );

    const output = document.getElementById("result");
    if (output) {
      output.innerHTML = "";
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
