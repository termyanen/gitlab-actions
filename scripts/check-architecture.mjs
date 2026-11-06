import ts from "typescript";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(root, "src");
const layers = ["app", "pages", "widgets", "features", "entities", "shared"];
const legacy = new Set([
  "background.js",
  "content.js",
  "content_proxy.js",
  "review-export.js",
  "review-import.js",
  "review-import-ui.js",
  "review-copy.js",
  "popup.js",
  "welcome.js",
]);
const violations = [];

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? files(path)
      : path.endsWith(".ts")
        ? [path]
        : [];
  });
}

function checkImport(file, specifier) {
  if (!specifier.startsWith(".")) return;
  const resolved = resolve(dirname(file), specifier);
  const target = [
    resolved,
    resolved + ".ts",
    resolved + ".js",
    join(resolved, "index.ts"),
  ].find(
    (candidate) => existsSync(candidate) && /\.(?:ts|js)$/.test(candidate),
  );
  if (!target) {
    violations.push(`${relative(root, file)}: unresolved import ${specifier}`);
    return;
  }
  const from = relative(sourceRoot, file).split("/");
  const to = relative(sourceRoot, target).split("/");
  if (to[0] === "..") {
    if (!(
      from[0] === "app" &&
      from[1] === "entrypoints" &&
      legacy.has(relative(root, target))
    )) {
      violations.push(
        `${relative(root, file)}: runtime import outside src: ${specifier}`,
      );
    }
    return;
  }
  const sameSlice =
    from[0] === to[0] &&
    (["app", "shared"].includes(from[0]) || from[1] === to[1]);
  if (!sameSlice && layers.indexOf(to[0]) <= layers.indexOf(from[0])) {
    violations.push(
      `${relative(root, file)}: forbidden ${from.slice(0, 2).join("/")} → ${to.slice(0, 2).join("/")}`,
    );
  }
  if (
    !sameSlice &&
    !["app", "shared"].includes(to[0]) &&
    !(to.length === 3 && /^(?:index|background|content)\.ts$/.test(to[2]))
  ) {
    violations.push(
      `${relative(root, file)}: use public API of ${to.slice(0, 2).join("/")}`,
    );
  }
}

for (const file of files(sourceRoot)) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  if (!layers.includes(relative(sourceRoot, file).split("/")[0]))
    violations.push(`${relative(root, file)}: unknown FSD layer`);
  if (/@ts-(?:nocheck|ignore)\b/.test(source.text))
    violations.push(`${relative(root, file)}: blanket TypeScript suppression`);
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      checkImport(file, node.moduleSpecifier.text);
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      ts.isStringLiteral(node.arguments[0])
    )
      checkImport(file, node.arguments[0].text);
    if (node.kind === ts.SyntaxKind.AnyKeyword)
      violations.push(
        `${relative(root, file)}: explicit any is not a migration strategy`,
      );
    ts.forEachChild(node, visit);
  }
  visit(source);
}

if (violations.length) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log("FSD import boundaries and TypeScript source checks passed.");
}
