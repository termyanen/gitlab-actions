import { build, context } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { watch } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const runtimeNames = [
  "background",
  "content",
  "content_proxy",
  "review-workflow",
  "review-export",
  "review-import",
  "review-import-ui",
  "review-copy",
  "popup",
  "welcome",
];
const assets = [
  "manifest.json",
  "popup.html",
  "welcome.html",
  "content.css",
  "icons",
  "_locales",
];

async function copyAssets(outdir) {
  await mkdir(outdir, { recursive: true });
  for (const asset of assets) {
    await cp(join(root, asset), join(outdir, asset), {
      recursive: true,
      filter: (path) =>
        !relative(root, path)
          .split(/[\\/]/)
          .some((part) => part.startsWith(".")),
    });
  }
}

export async function buildExtension({
  outdir = join(root, "dist"),
  development = false,
  watching = false,
} = {}) {
  await rm(outdir, { recursive: true, force: true });
  await copyAssets(outdir);
  const options = {
    absWorkingDir: root,
    entryPoints: Object.fromEntries(
      runtimeNames.map((name) => [name, `src/app/entrypoints/${name}.ts`]),
    ),
    outdir,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "chrome88",
    minify: !development,
    sourcemap: development ? "external" : false,
    legalComments: "none",
    metafile: true,
    logLevel: "warning",
  };
  if (watching) {
    const builder = await context(options);
    await builder.watch();
    const watchers = assets.map((asset) =>
      watch(join(root, asset), { recursive: true }, () => {
        copyAssets(outdir).catch((error) => console.error(error));
      }),
    );
    console.log(
      `Watching extension sources. Load ${outdir} in chrome://extensions.`,
    );
    const close = async () => {
      watchers.forEach((watcher) => watcher.close());
      await builder.dispose();
      process.exit(0);
    };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
    return;
  }
  const result = await build(options);
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
  const manifest = JSON.parse(
    await readFile(join(outdir, "manifest.json"), "utf8"),
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
