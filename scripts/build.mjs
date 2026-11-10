import { build, context } from "esbuild";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { watch } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  moduleEntryPoints,
  scriptEntryPoints,
  uiEntryPoints,
} from "./entrypoints.mjs";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assets = [
  "manifest.json",
  "popup.html",
  "quick-popup.html",
  "settings.css",
  "welcome.html",
  "content.css",
  "icons",
  "_locales",
];

async function copyAssets(outdir) {
  await mkdir(outdir, { recursive: true });
  for (const asset of assets) {
    if (asset === "manifest.json" || asset === "content.css") continue;
    await cp(join(root, asset), join(outdir, asset), {
      recursive: true,
      filter: (path) =>
        !relative(root, path)
          .split(/[\\/]/)
          .some((part) => part.startsWith(".")),
    });
  }
  // Content-script CSS is registered from the manifest, independently of JS
  // chunks. Give each CSS revision its own URL so an unpacked update cannot
  // reuse a cached stylesheet at the previous build's stable content.css URL.
  const css = await readFile(join(root, "content.css"));
  const stylesheet = `content-${createHash("sha256").update(css).digest("hex").slice(0, 16)}.css`;
  const manifest = JSON.parse(
    await readFile(join(root, "manifest.json"), "utf8"),
  );
  for (const entry of manifest.content_scripts) {
    if (entry.css)
      entry.css = entry.css.map((file) =>
        file === "content.css" ? stylesheet : file,
      );
  }
  await writeFile(join(outdir, stylesheet), css);
  // Publish the manifest only after its stylesheet exists. During watch mode,
  // keep previous hashes until a clean build for tabs still using that manifest.
  await writeFile(
    join(outdir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );

  // Minification removes inline license comments, so retain the actual bundled
  // React/React DOM/Scheduler MIT notices as a local archive resource.
  const notices = await Promise.all(
    ["react", "react-dom", "scheduler"].map(async (name) => {
      const directory = join(root, "node_modules", name);
      const metadata = JSON.parse(
        await readFile(join(directory, "package.json"), "utf8"),
      );
      return `${name} ${metadata.version}\n\n${await readFile(join(directory, "LICENSE"), "utf8")}`;
    }),
  );
  await writeFile(
    join(outdir, "THIRD_PARTY_NOTICES.txt"),
    notices.join("\n\n"),
  );
}

export async function buildExtension({
  outdir = join(root, "dist"),
  development = false,
  watching = false,
} = {}) {
  await rm(outdir, { recursive: true, force: true });
  await copyAssets(outdir);
  const manifest = JSON.parse(
    await readFile(join(outdir, "manifest.json"), "utf8"),
  );
  const options = {
    absWorkingDir: root,
    entryPoints: scriptEntryPoints,
    outdir,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: `chrome${manifest.minimum_chrome_version}`,
    minify: !development,
    sourcemap: development ? "external" : false,
    legalComments: "none",
    metafile: true,
    logLevel: "warning",
  };
  const moduleOptions = {
    ...options,
    entryPoints: moduleEntryPoints,
    format: "esm",
    splitting: true,
    chunkNames: "modules/chunks/[name]-[hash]",
  };
  const uiOptions = {
    ...options,
    entryPoints: uiEntryPoints,
    format: "esm",
    splitting: true,
    chunkNames: "ui/chunks/[name]-[hash]",
    jsx: "automatic",
    define: {
      "process.env.NODE_ENV": JSON.stringify(
        development ? "development" : "production",
      ),
    },
  };
  if (watching) {
    const builders = await Promise.all([
      context(options),
      context(moduleOptions),
      context(uiOptions),
    ]);
    await Promise.all(builders.map((builder) => builder.watch()));
    let assetCopies = Promise.resolve();
    const watchers = assets.map((asset) =>
      watch(join(root, asset), { recursive: true }, () => {
        assetCopies = assetCopies
          .then(() => copyAssets(outdir))
          .catch((error) => console.error(error));
      }),
    );
    console.log(
      `Watching extension sources. Load ${outdir} in chrome://extensions.`,
    );
    const close = async () => {
      watchers.forEach((watcher) => watcher.close());
      await Promise.all(builders.map((builder) => builder.dispose()));
      process.exit(0);
    };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
    return;
  }
  const results = await Promise.all([
    build(options),
    build(moduleOptions),
    build(uiOptions),
  ]);
  const result = {
    metafile: {
      inputs: Object.assign(
        {},
        ...results.map((result) => result.metafile.inputs),
      ),
      outputs: Object.assign(
        {},
        ...results.map((result) => result.metafile.outputs),
      ),
    },
  };
  const report = Object.fromEntries(
    Object.entries(result.metafile.outputs).map(([path, output]) => [
      path,
      output.bytes,
    ]),
  );
  await mkdir(join(root, ".reports"), { recursive: true });
  await writeFile(
    join(root, ".reports/build.json"),
    JSON.stringify({ outputs: report, metafile: result.metafile }, null, 2) +
      "\n",
  );
  console.log(`Built extension ${manifest.version} in ${outdir}`);
  return result;
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] || "")).href) {
  await buildExtension({
    development: process.argv.includes("--dev"),
    watching: process.argv.includes("--watch"),
  });
}
