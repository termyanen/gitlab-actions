import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const API = "https://chromewebstore.googleapis.com";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REQUEST_TIMEOUT_MS = 30_000;
const UPLOAD_POLL_INTERVAL_MS = 5_000;
const UPLOAD_POLL_ATTEMPTS = 60;
const ACCEPTED_SUBMISSIONS = new Set([
  "PENDING_REVIEW",
  "STAGED",
  "PUBLISHED",
  "PUBLISHED_TO_TESTERS",
]);

export function storeConfig(env) {
  const names = [
    "CWS_PUBLISHER_ID",
    "CWS_EXTENSION_ID",
    "CWS_CLIENT_ID",
    "CWS_CLIENT_SECRET",
    "CWS_REFRESH_TOKEN",
  ];
  for (const name of names)
    if (!env[name]?.trim())
      throw new Error(`Missing CI configuration: ${name}`);
  if (!/^[a-zA-Z0-9-]+$/.test(env.CWS_PUBLISHER_ID))
    throw new Error("Invalid CWS_PUBLISHER_ID");
  if (!/^[a-p]{32}$/.test(env.CWS_EXTENSION_ID))
    throw new Error("Invalid CWS_EXTENSION_ID");
  const action = env.CWS_ACTION || "upload";
  if (!["upload", "publish"].includes(action))
    throw new Error("Invalid CWS_ACTION");
  return {
    action,
    publisherId: env.CWS_PUBLISHER_ID,
    extensionId: env.CWS_EXTENSION_ID,
    clientId: env.CWS_CLIENT_ID,
    clientSecret: env.CWS_CLIENT_SECRET,
    refreshToken: env.CWS_REFRESH_TOKEN,
  };
}

export function checkReleaseVersion(version, archiveVersion, tag = "") {
  if (version !== archiveVersion)
    throw new Error("ZIP version does not match manifest.json");
  if (tag && tag.replace(/^v/, "") !== version)
    throw new Error("Release tag does not match manifest.json");
}

/** Injectable transport keeps regression tests entirely offline. Never log tokens or response bodies. */
export async function uploadToStore({
  config,
  archive,
  version,
  fetchImpl = fetch,
  pause = delay,
  pollAttempts = UPLOAD_POLL_ATTEMPTS,
}) {
  async function request(label, url, options = {}) {
    let response;
    try {
      response = await fetchImpl(url, {
        ...options,
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new Error(
        `${label}: network error or timeout; no automatic write retry`,
      );
    }
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error(`${label}: invalid JSON (HTTP ${response.status})`);
    }
    if (!response.ok || !data || typeof data !== "object" || data.error)
      throw new Error(`${label}: rejected (HTTP ${response.status})`);
    return data;
  }
  const token = await request("OAuth token", TOKEN_URL, {
    method: "POST",
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (typeof token.access_token !== "string" || !token.access_token.trim())
    throw new Error("OAuth token: missing access token");
  const name = `publishers/${config.publisherId}/items/${config.extensionId}`;
  const headers = { Authorization: `Bearer ${token.access_token}` };
  const uploaded = await request(
    "Package upload",
    `${API}/upload/v2/${name}:upload`,
    {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/zip" },
      body: archive,
    },
  );
  if (uploaded.crxVersion && uploaded.crxVersion !== version)
    throw new Error("Uploaded version does not match verified ZIP");
  let state = uploaded.uploadState;
  for (
    let attempt = 0;
    ["IN_PROGRESS", "UPLOAD_IN_PROGRESS"].includes(state) &&
    attempt < pollAttempts;
    attempt++
  ) {
    await pause(UPLOAD_POLL_INTERVAL_MS);
    const status = await request(
      "Upload status",
      `${API}/v2/${name}:fetchStatus`,
      { headers },
    );
    state = status.lastAsyncUploadState;
  }
  if (state !== "SUCCEEDED")
    throw new Error(
      "Package upload did not finish successfully; publication skipped",
    );
  if (config.action === "upload") return { uploadState: state };
  const submitted = await request(
    "Publish submission",
    `${API}/v2/${name}:publish`,
    {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ publishType: "DEFAULT_PUBLISH" }),
    },
  );
  if (!ACCEPTED_SUBMISSIONS.has(submitted.state))
    throw new Error("Publish submission did not reach an accepted state");
  return { uploadState: state, submissionState: submitted.state };
}

async function main() {
  const config = storeConfig(process.env);
  const archivePath = resolve(process.argv[2] || "extension.zip");
  const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
  const packaged = JSON.parse(
    execFileSync("unzip", ["-p", archivePath, "manifest.json"], {
      encoding: "utf8",
    }),
  );
  checkReleaseVersion(
    manifest.version,
    packaged.version,
    process.env.CWS_RELEASE_TAG,
  );
  const result = await uploadToStore({
    config,
    archive: await readFile(archivePath),
    version: manifest.version,
  });
  console.log(JSON.stringify(result));
}
if (import.meta.url === pathToFileURL(resolve(process.argv[1] || "")).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
