import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const directory = join(root, "vendor/xdiff");
export async function verifyXdiff() {
  const expected = JSON.parse(
    await readFile(join(directory, "checksums.json"), "utf8"),
  );
  const files = (await readdir(directory))
    .filter((name) => name !== "checksums.json")
    .sort();
  if (JSON.stringify(files) !== JSON.stringify(Object.keys(expected).sort()))
    throw new Error("xdiff source inventory differs from checksums");
  for (const [name, hash] of Object.entries(expected)) {
    const actual = createHash("sha256")
      .update(await readFile(join(directory, name)))
      .digest("hex");
    if (actual !== hash) throw new Error(`xdiff integrity mismatch: ${name}`);
  }
}
async function rebuild() {
  const sdk = process.env.WASI_SDK_PATH;
  if (!sdk)
    throw new Error(
      "Set WASI_SDK_PATH to the extracted WASI SDK 34.0 directory",
    );
  const sources = (await readdir(directory))
    .filter((name) => name.endsWith(".c"))
    .sort()
    .map((name) => `vendor/xdiff/${name}`);
  execFileSync(
    join(sdk, "bin/clang"),
    [
      "-O2",
      "-DNDEBUG",
      "-mexec-model=reactor",
      "-Wl,--export=malloc",
      "-Wl,--export=free",
      "-Wl,--export=merge_files",
      "-Wl,--export=result_ptr",
      "-Wl,--export=result_size",
      "-Wl,-z,stack-size=262144",
      "-Wl,--initial-memory=1048576",
      "-Wl,--max-memory=67108864",
      "-Wl,--strip-all",
      ...sources,
      "-o",
      "vendor/xdiff/merge.wasm",
    ],
    { cwd: root, stdio: "inherit" },
  );
}
if (import.meta.url === pathToFileURL(resolve(process.argv[1] || "")).href) {
  if (process.argv.includes("--build")) await rebuild();
  await verifyXdiff();
  console.log("xdiff source and binary integrity verified");
}
