import crypto from "node:crypto";
import fs from "node:fs";
import { createReadStream } from "node:fs";
import fsPromises from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { google } from "googleapis";
import type { drive_v3 } from "googleapis";
import type { OAuth2Client } from "googleapis-common";

type Drive = drive_v3.Drive;

interface AccountSpec {
  email: string;
  label: string;
}

interface NodeSpec {
  type: string;
  name: string;
  owner?: string;
  asset?: string;
  sourceId?: string;
  linkResponseSheet?: string;
  children?: NodeSpec[];
}

interface FixtureSpec {
  accounts: AccountSpec[];
  root: NodeSpec & { children?: NodeSpec[] };
}

interface StoredCredential {
  email: string;
  client_id: string;
  refresh_token: string;
  scopes: string[];
  created_at: string;
}

const OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/forms.body",
  "https://www.googleapis.com/auth/spreadsheets",
];
// Explicitly use /tmp to avoid macOS per-user temp paths like /var/folders/... .
const TOKEN_DIR = path.join("/tmp", process.env.USER ?? "unknown", "gd-migrate-test", "credentials");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, "..", "assets");

function log(msg: string) {
  console.error(msg);
}

function fatal(msg: string): never {
  log(msg);
  process.exit(1);
}

function ensureEnv(name: string): string {
  const val = process.env[name];
  if (!val) fatal(`Missing env ${name}`);
  return val;
}

async function ensureDir(dir: string, mode = 0o700) {
  await fsPromises.mkdir(dir, { recursive: true, mode });
  await fsPromises.chmod(dir, mode).catch(() => {});
}

function credPath(email: string) {
  const safe = email.replace(/[^a-zA-Z0-9_.@-]/g, "_");
  return path.join(TOKEN_DIR, `${safe}.json`);
}

async function saveCredential(email: string, refreshToken: string, scopes: string[], clientId: string) {
  await ensureDir(TOKEN_DIR);
  const data: StoredCredential = {
    email,
    client_id: clientId,
    refresh_token: refreshToken,
    scopes,
    created_at: new Date().toISOString(),
  };
  const file = credPath(email);
  await fsPromises.writeFile(file, JSON.stringify(data, null, 2), { mode: 0o600 });
  await fsPromises.chmod(file, 0o600).catch(() => {});
  log(`Stored refresh token for ${email} at ${file}`);
}

async function listCredentials(): Promise<StoredCredential[]> {
  try {
    const entries = await fsPromises.readdir(TOKEN_DIR);
    const creds: StoredCredential[] = [];
    for (const entry of entries) {
      const full = path.join(TOKEN_DIR, entry);
      const stat = await fsPromises.stat(full);
      if (!stat.isFile()) continue;
      try {
        const data = JSON.parse(await fsPromises.readFile(full, "utf8")) as StoredCredential;
        if (data.email && data.refresh_token) creds.push(data);
      } catch {
        // ignore invalid files
      }
    }
    return creds;
  } catch (err: any) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }
}

async function loadCredential(email: string): Promise<StoredCredential | null> {
  try {
    const data = JSON.parse(await fsPromises.readFile(credPath(email), "utf8")) as StoredCredential;
    return data.refresh_token ? data : null;
  } catch (err: any) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

function randomString(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

async function openBrowser(url: string, profileDir?: string) {
  const isMac = process.platform === "darwin";
  const isLinux = process.platform === "linux";
  if (isMac) {
    let args: string[] = [];
    let cmd = "open"
    if (profileDir) {
      cmd  = "/Applications/Google\ Chrome.app/Contents/MacOS/Google Chrome"
      args.push(`--profile-directory=${profileDir}`);
    }
    args.push(url);
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
    return;
  }
  if (isLinux) {
    const args = profileDir ? [`google-chrome`, `--profile-directory=${profileDir}`, url] : ["xdg-open", url];
    const cmd = profileDir ? args.shift()! : "xdg-open";
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
    return;
  }
  // fallback
  spawn("open", [url], { stdio: "ignore", detached: true }).unref();
}

async function runAuth(account: string, profileDir?: string) {
  const clientId = ensureEnv("TEST_TOOL_GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = ensureEnv("TEST_TOOL_GOOGLE_OAUTH_CLIENT_SECRET");

  const verifier = randomString(48);
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const state = randomString(24);

  const server = http.createServer();
  const listen = new Promise<{ code: string }>((resolve, reject) => {
    server.on("request", (req, res) => {
      const url = new URL(req.url || "/", `http://${req.headers.host}`);
      if (url.pathname !== "/oauth2callback") {
        res.statusCode = 404;
        res.end();
        return;
      }
      const gotState = url.searchParams.get("state");
      const code = url.searchParams.get("code");
      if (!code || gotState !== state) {
        res.statusCode = 400;
        res.end("Invalid state or code");
        reject(new Error("Invalid state or code"));
        server.close();
        return;
      }
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/plain");
      res.end("OK, you can close this window.");
      resolve({ code });
      server.close();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address !== "object" || !address) fatal("Failed to bind local callback port.");
  const redirectUri = `http://127.0.0.1:${address.port}/oauth2callback`;

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", OAUTH_SCOPES.join(" "));
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("login_hint", account);

  log(`Opening browser for ${account}...`);
  await openBrowser(authUrl.toString(), profileDir);

  const { code } = await listen;
  log("Exchanging code for tokens...");
  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenResp.ok) {
    fatal(`Token exchange failed: ${tokenResp.status} ${await tokenResp.text()}`);
  }
  const tokenJson = (await tokenResp.json()) as any;
  const refresh = tokenJson.refresh_token;
  if (!refresh) fatal("No refresh_token returned; check OAuth client settings and consent prompt.");
  await saveCredential(account, refresh, [...OAUTH_SCOPES], clientId);
}

const authCache = new Map<string, OAuth2Client>();
const driveCache = new Map<string, Drive>();

async function getAuthForEmail(email: string): Promise<OAuth2Client> {
  const cached = authCache.get(email);
  if (cached) return cached;
  const cred = await loadCredential(email);
  if (!cred) fatal(`No stored credentials for ${email}. Run auth first.`);
  const missing = OAUTH_SCOPES.filter((s) => !(cred.scopes ?? []).includes(s));
  if (missing.length) {
    fatal(
      `Stored token for ${email} is missing required scopes (${missing.join(
        ", ",
      )}). Please re-run auth for this account.`,
    );
  }
  const clientId = ensureEnv("TEST_TOOL_GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = ensureEnv("TEST_TOOL_GOOGLE_OAUTH_CLIENT_SECRET");
  const client = new google.auth.OAuth2(clientId, clientSecret);
  client.setCredentials({ refresh_token: cred.refresh_token });
  authCache.set(email, client);
  return client;
}

async function getDriveForEmail(email: string): Promise<Drive> {
  const cached = driveCache.get(email);
  if (cached) return cached;
  const auth = await getAuthForEmail(email);
  const drive = google.drive({ version: "v3", auth });
  driveCache.set(email, drive);
  return drive;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let attempt = 0;
  let delay = 500;
  for (;;) {
    try {
      return await fn();
    } catch (err: any) {
      const status = err?.response?.status ?? err?.code;
      if ((status === 429 || (typeof status === "number" && status >= 500 && status < 600)) && attempt < 3) {
        attempt += 1;
        log(`Retrying ${label} after ${delay}ms (status ${status})`);
        await sleep(delay);
        delay *= 2;
        continue;
      }
      throw err;
    }
  }
}

function loadSpec(specPath: string): FixtureSpec {
  const raw = fs.readFileSync(specPath, "utf8");
  const spec = JSON.parse(raw) as FixtureSpec;
  if (!spec.accounts?.length) fatal("Spec missing accounts");
  if (!spec.root || !spec.root.name) fatal("Spec missing root.name");
  return spec;
}

function ownerEmailForLabel(label: string | undefined, defaultLabel: string, map: Map<string, string>): string {
  const resolved = label ?? defaultLabel;
  const email = map.get(resolved);
  if (!email) fatal(`Unknown owner label: ${resolved}`);
  return email;
}

async function createFolder(drive: Drive, name: string, parentId: string, verbose: boolean) {
  const res = await withRetry(
    () =>
      drive.files.create({
        requestBody: { name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] },
        supportsAllDrives: true,
        fields: "id",
      }),
    `create folder ${name}`,
  );
  const id = res.data.id;
  if (!id) throw new Error("Folder creation missing id");
  if (verbose) log(`Created folder ${name} -> ${id}`);
  return id;
}

async function createGoogleFile(drive: Drive, mimeType: string, name: string, parentId: string, verbose: boolean) {
  const res = await withRetry(
    () =>
      drive.files.create({
        requestBody: { name, mimeType, parents: [parentId] },
        supportsAllDrives: true,
        fields: "id",
      }),
    `create file ${name}`,
  );
  const id = res.data.id;
  if (!id) throw new Error("File creation missing id");
  if (verbose) log(`Created file ${name} -> ${id}`);
  return id;
}

async function uploadAsset(
  drive: Drive,
  mimeType: string,
  name: string,
  parentId: string,
  assetPath: string,
  verbose: boolean,
) {
  const res = await withRetry(
    () =>
      drive.files.create({
        requestBody: { name, mimeType, parents: [parentId] },
        media: { mimeType, body: createReadStream(assetPath) },
        supportsAllDrives: true,
        fields: "id",
      }),
    `upload ${name}`,
  );
  const id = res.data.id;
  if (!id) throw new Error("Upload missing id");
  if (verbose) log(`Uploaded ${name} (${assetPath}) -> ${id}`);
  return id;
}

async function copyFile(drive: Drive, sourceId: string, name: string, parentId: string, verbose: boolean) {
  const res = await withRetry(
    () =>
      drive.files.copy({
        fileId: sourceId,
        requestBody: { name, parents: [parentId] },
        supportsAllDrives: true,
        fields: "id",
      }),
    `copy ${sourceId}`,
  );
  const id = res.data.id;
  if (!id) throw new Error("Copy missing id");
  if (verbose) log(`Copied ${sourceId} -> ${id}`);
  return id;
}

async function linkFormToSheet(email: string, formId: string, sheetId: string, verbose: boolean) {
  // NOTE: The Google Forms API (v1) exposes `linkedSheetId` as output-only and FormSettings
  // does not contain any response-destination field. So there is currently no supported REST
  // operation to programmatically link a Form to a response spreadsheet.
  //
  // What we *can* do here is verify whether the form is already linked to the expected sheet
  // and provide a clear failure message if not.

  const auth = await getAuthForEmail(email);
  const { token } = await auth.getAccessToken();
  if (!token) fatal(`Failed to get access token for ${email}`);

  const url = new URL(`https://forms.googleapis.com/v1/forms/${formId}`);
  // Keep the response small and stable.
  url.searchParams.set("fields", "formId,linkedSheetId");

  const resp = await withRetry(
    () =>
      fetch(url.toString(), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }),
    "forms.get (linkedSheetId)",
  );

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Forms get failed (${resp.status}) for form ${formId} as ${email}; response: ${text}`);
  }

  const json = (await resp.json()) as any;
  const linkedSheetId: string | undefined = json?.linkedSheetId ?? undefined;

  if (linkedSheetId === sheetId) {
    if (verbose) log(`Form ${formId} already linked to sheet ${sheetId}`);
    return;
  }

  if (!linkedSheetId) {
    log(
      [
        `Warning: Form ${formId} is not linked to any response spreadsheet (linkedSheetId is empty).`,
        `The Google Forms REST API does not currently support setting the response destination programmatically.`,
        `Please link it manually in the Forms UI: open the form → Responses → Sheets icon → select existing spreadsheet → paste ${sheetId}.`,
      ].join("\n"),
    );
    return;
  }

  log(
    [
      `Warning: Form ${formId} is linked to a different spreadsheet (${linkedSheetId}) than requested (${sheetId}).`,
      `The Google Forms REST API does not currently support changing the response destination programmatically.`,
      `Fix it manually in the Forms UI (Responses → Sheets icon) or adjust the fixture to match the existing linked sheet.`,
    ].join("\n"),
  );
}

async function buildTree(
  node: NodeSpec,
  parentId: string,
  ownerLabel: string,
  labelToEmail: Map<string, string>,
  defaultLabel: string,
  verbose: boolean,
) {
  const email = ownerEmailForLabel(node.owner, ownerLabel ?? defaultLabel, labelToEmail);
  const drive = await getDriveForEmail(email);
  const mimeType = node.type;
  if (mimeType === "application/vnd.google-apps.folder") {
    const folderId = await createFolder(drive, node.name, parentId, verbose);
    for (const child of node.children ?? []) {
      await buildTree(child, folderId, node.owner ?? ownerLabel, labelToEmail, defaultLabel, verbose);
    }
    return;
  }

  if (mimeType === "copy") {
    if (!node.sourceId) fatal(`copy node ${node.name} missing sourceId`);
    const newId = await copyFile(drive, node.sourceId, node.name, parentId, verbose);
    if (node.linkResponseSheet) {
      await linkFormToSheet(email, newId, node.linkResponseSheet, verbose);
    }
    return;
  }

  if (node.asset) {
    const assetPath = path.join(ASSETS_DIR, node.asset);
    if (!fs.existsSync(assetPath)) fatal(`Asset not found: ${assetPath}`);
    await uploadAsset(drive, mimeType, node.name, parentId, assetPath, verbose);
    return;
  }

  await createGoogleFile(drive, mimeType, node.name, parentId, verbose);
}

async function listDirectChildren(drive: Drive, parentId: string) {
  const children: Array<{ id: string; mimeType?: string; name?: string }> = [];
  let pageToken: string | undefined;
  do {
    const res = await withRetry(
      () =>
        drive.files.list({
          q: `'${parentId}' in parents and trashed=false`,
          fields: "files(id,mimeType,name),nextPageToken",
          pageSize: 1000,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
          pageToken,
        }),
      "list children",
    );
    (res.data.files ?? []).forEach((f) => {
      if (f.id) children.push({ id: f.id, mimeType: f.mimeType ?? undefined, name: f.name ?? undefined });
    });
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return children;
}

async function purgeFolderContents(drive: Drive, parentId: string, verbose: boolean) {
  const children = await listDirectChildren(drive, parentId);
  for (const child of children) {
    const isFolder = child.mimeType === "application/vnd.google-apps.folder";
    if (isFolder) {
      await purgeFolderContents(drive, child.id, verbose);
    }
    await withRetry(
      () =>
        drive.files.delete({
          fileId: child.id,
          supportsAllDrives: true,
        }),
      `delete ${child.name || child.id}`,
    );
    if (verbose) log(`Deleted ${child.name || child.id}`);
  }
}

async function ensureAccessForAll(rootId: string, accounts: AccountSpec[]) {
  for (const account of accounts) {
    const drive = await getDriveForEmail(account.email);
    try {
      await withRetry(
        () =>
          drive.files.get({
            fileId: rootId,
            supportsAllDrives: true,
            fields: "id,name",
          }),
        `check access for ${account.email}`,
      );
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message || err?.message || String(err);
      fatal(`Account ${account.email} cannot access root ${rootId}: ${msg}`);
    }
  }
}

async function handlePopulate(specPath: string, rootId: string, verbose: boolean) {
  const spec = loadSpec(specPath);
  const labelToEmail = new Map(spec.accounts.map((a) => [a.label, a.email]));
  const defaultLabel = spec.root.owner ?? spec.accounts[0].label;
  await ensureAccessForAll(rootId, spec.accounts);
  for (const child of spec.root.children ?? []) {
    await buildTree(child, rootId, defaultLabel, labelToEmail, defaultLabel, verbose);
  }
}

async function handleClean(rootId: string, account?: string) {
  const creds = await listCredentials();
  if (creds.length === 0) fatal("No stored credentials. Run auth first.");
  const targetEmail = account ?? creds[0].email;
  const drive = await getDriveForEmail(targetEmail);
  log(`Cleaning contents of root ${rootId} using ${targetEmail}...`);
  await purgeFolderContents(drive, rootId, true);
  log(`Cleaned contents of ${rootId}`);
}

function printHelp() {
  const help = `
Usage: drive-populate <command> [options]

Commands:
  auth --account <email> [--chrome-profile-dir <dir>]   Start OAuth flow and store refresh token
  list-accounts                                         List stored credentials
  populate --spec <path> --root-id <id> [--verbose]     Populate an existing root folder
  clean --root-id <id> [--account <email>]              Delete all contents under the root (root stays)
`;
  console.error(help.trim());
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "auth": {
      const { values } = parseArgs({
        args: rest,
        options: { account: { type: "string" }, "chrome-profile-dir": { type: "string" } },
        allowPositionals: true,
      });
      if (!values.account) fatal("auth requires --account");
      await runAuth(values.account, values["chrome-profile-dir"]);
      break;
    }
    case "list-accounts": {
      const creds = await listCredentials();
      if (creds.length === 0) {
        console.log("No accounts stored.");
        break;
      }
      for (const cred of creds) {
        console.log(`${cred.email}\t${cred.created_at}`);
      }
      break;
    }
    case "populate": {
      const { values } = parseArgs({
        args: rest,
        options: { spec: { type: "string" }, "root-id": { type: "string" }, verbose: { type: "boolean" } },
        allowPositionals: true,
      });
      if (!values.spec || !values["root-id"]) fatal("populate requires --spec and --root-id");
      await handlePopulate(path.resolve(values.spec), values["root-id"], Boolean(values.verbose));
      break;
    }
    case "clean": {
      const { values } = parseArgs({
        args: rest,
        options: { "root-id": { type: "string" }, account: { type: "string" } },
        allowPositionals: true,
      });
      if (!values["root-id"]) fatal("clean requires --root-id");
      await handleClean(values["root-id"], values.account);
      break;
    }
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printHelp();
      break;
    default:
      fatal(`Unknown command: ${command}`);
  }
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
