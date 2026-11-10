import { execFileSync } from "node:child_process";
import { readdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { root } from "./build.mjs";

async function filesIn(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(join(directory, prefix), {
    withFileTypes: true,
  })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (
      entry.name.startsWith(".") ||
      entry.name.endsWith(".map") ||
      entry.isSymbolicLink()
    ) {
      throw new Error(`Unexpected distribution resource: ${path}`);
    }
    if (entry.isDirectory()) files.push(...(await filesIn(directory, path)));
    else files.push(path);
  }
  return files.sort();
}

export async function packageExtension({
  directory = join(root, "dist"),
  archive,
} = {}) {
  const manifest = JSON.parse(
    await readFile(join(directory, "manifest.json"), "utf8"),
  );
  const destination = resolve(
    archive || join(root, `gitlab-mr-actions-v${manifest.version}.zip`),
  );
  const files = await filesIn(directory);
  if (
    files.some((file) =>
      /(?:^|\/)(?:node_modules|tests|src)(?:\/|$)|\.(?:ts|tsx|cjs|mjs)$/.test(
        file,
      ),
    )
  ) {
    throw new Error("Development files must not be packaged");
  }
  await rm(destination, { force: true });
  execFileSync("zip", ["-X", "-q", destination, "-@"], {
    cwd: directory,
    input: files.join("\n") + "\n",
  });
  console.log(`Created ${destination}`);
  return destination;
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] || "")).href) {
  await packageExtension({ archive: process.argv[2] });
}
