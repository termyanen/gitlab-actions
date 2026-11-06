import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const RELEASE_HEADING = /^\d+\.\d+\.\d+(?:\.\d+)?$/;
const CHANGELOGS = ["CHANGELOG.md", "CHANGELOG_RU.md"];
const GENERATED_PAGES = ["docs/review-guide.html", "docs/privacy.html"];

export function parseChangelog(source, label) {
  const headings = [...source.matchAll(/^## ([^\r\n]+)\r?$/gm)];
  const sections = headings.map((heading, index) => ({
    title: heading[1].trim(),
    body: source
      .slice(heading.index + heading[0].length, headings[index + 1]?.index)
      .trim()
      .replace(/\n---\s*$/, "")
      .trim(),
  }));
  const releases = sections.filter(({ title }) => RELEASE_HEADING.test(title));
  const pending = sections.filter(({ title }) => /^unreleased$/i.test(title));
  if (
    !releases.length ||
    new Set(releases.map((r) => r.title)).size !== releases.length
  )
    throw new Error(`${label}: missing or duplicate release headings`);
  if (pending.length > 1)
    throw new Error(`${label}: duplicate Unreleased sections`);
  for (let index = 1; index < releases.length; index++) {
    const newer = releases[index - 1].title.split(".").map(Number);
    const older = releases[index].title.split(".").map(Number);
    let order = 0;
    for (let part = 0; part < 4 && !order; part++)
      order = (newer[part] || 0) - (older[part] || 0);
    if (order <= 0)
      throw new Error(`${label}: release versions must be newest first`);
  }
  return { releases, pending: pending[0]?.body || "" };
}

/** Read-only validation of every published version and changelog copy. */
export async function checkRelease(directory, { ready = false } = {}) {
  const read = (file) => readFile(join(directory, file), "utf8");
  const manifest = JSON.parse(await read("manifest.json"));
  const version = manifest.version;
  if (
    typeof version !== "string" ||
    !/^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){2,3}$/.test(version) ||
    version.split(".").some((part) => Number(part) > 65535) ||
    !version.split(".").some(Number)
  )
    throw new Error("manifest.json: invalid extension release version");
  const packageMetadata = JSON.parse(await read("package.json"));
  if (Object.hasOwn(packageMetadata, "version"))
    throw new Error("package.json must not define a second release version");

  const changelogs = [];
  for (const file of CHANGELOGS) {
    const source = await read(file);
    const parsed = parseChangelog(source, file);
    if (parsed.releases[0].title !== version || !parsed.releases[0].body)
      throw new Error(
        `${file}: first release must be ${version} with release notes`,
      );
    if ((await read(`docs/${file}`)) !== source)
      throw new Error(`docs/${file}: stale copy; run npm run docs:build`);
    changelogs.push(parsed);
  }
  if (
    JSON.stringify(changelogs[0].releases.map((r) => r.title)) !==
    JSON.stringify(changelogs[1].releases.map((r) => r.title))
  )
    throw new Error("English and Russian changelog histories differ");
  if (Boolean(changelogs[0].pending) !== Boolean(changelogs[1].pending))
    throw new Error("Document pending changes in both Unreleased sections");
  if (ready && changelogs.some((log) => log.pending))
    throw new Error("Promote Unreleased notes before preparing this release");

  const landing = await read("docs/index.html");
  const metadata = [
    ...landing.matchAll(
      /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ]
    .map((match) => JSON.parse(match[1]))
    .filter((data) => data["@type"] === "SoftwareApplication");
  if (metadata.length !== 1 || metadata[0].softwareVersion !== version)
    throw new Error(`docs/index.html: softwareVersion must be ${version}`);
  for (const file of GENERATED_PAGES) {
    const page = await read(file);
    const versions = [
      ...page.matchAll(/<span>GitLab MR Actions · ([^<]+)<\/span>/g),
    ];
    if (versions.length !== 1 || versions[0][1] !== version)
      throw new Error(`${file}: stale version footer; run npm run docs:build`);
  }
  return {
    version,
    english: changelogs[0].releases[0].body,
    russian: changelogs[1].releases[0].body,
  };
}

export function releaseNotes({ version, english, russian }) {
  return `# GitLab MR Actions ${version}\n\n## English\n\n${english}\n\n## Русский\n\n${russian}\n`;
}

async function main() {
  const [command, ...flags] = process.argv.slice(2);
  if (
    !["check", "notes"].includes(command) ||
    flags.some((flag) => flag !== "--ready")
  )
    throw new Error("Usage: node scripts/release.mjs check [--ready] | notes");
  const release = await checkRelease(resolve(import.meta.dirname, ".."), {
    ready: command === "notes" || flags.includes("--ready"),
  });
  process.stdout.write(
    command === "notes"
      ? releaseNotes(release)
      : `Release metadata and documentation match ${release.version}.\n`,
  );
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] || "")).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
