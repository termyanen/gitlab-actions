import ts from "typescript";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { moduleEntryPoints, scriptEntryPoints } from "./entrypoints.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const layers = ["app", "pages", "widgets", "features", "entities", "shared"];
const publicEntries = /^(?:index|background|content)\.ts$/;

/** Checks source boundaries without loading or executing application modules. */
export function checkArchitecture(sourceRoot, { entryPoints } = {}) {
  sourceRoot = resolve(sourceRoot);
  const violations = [];
  const graph = new Map();
  const sourceGraph = new Map();
  const label = (file) => relative(sourceRoot, file).split(sep).join("/");

  function files(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        violations.push(`${label(path)}: runtime source must not use symlinks`);
        return [];
      }
      if (
        entry.isFile() &&
        /\.[cm]?[jt]sx?$/.test(entry.name) &&
        !entry.name.endsWith(".ts")
      )
        violations.push(
          `${label(path)}: runtime must be TypeScript .ts covered by typecheck and architecture checks`,
        );
      return entry.isDirectory()
        ? files(path)
        : path.endsWith(".ts")
          ? [path]
          : [];
    });
  }

  function checkImport(file, specifier, runtime = true) {
    if (!specifier.startsWith(".")) {
      violations.push(
        `${label(file)}: runtime source imports must be relative: ${specifier}`,
      );
      return;
    }
    const resolved = resolve(dirname(file), specifier);
    const target = [
      resolved,
      resolved + ".ts",
      resolved.replace(/\.js$/, ".ts"),
      join(resolved, "index.ts"),
    ].find((candidate) => existsSync(candidate) && /\.ts$/.test(candidate));
    if (!target) {
      violations.push(`${label(file)}: unresolved import ${specifier}`);
      return;
    }
    const from = label(file).split("/");
    const to = label(target).split("/");
    if (to[0] === "..") {
      violations.push(
        `${label(file)}: runtime import outside src: ${specifier}`,
      );
      return;
    }
    if (!graph.has(target)) {
      violations.push(
        `${label(file)}: import target is outside the checked source graph: ${specifier}`,
      );
      return;
    }
    const sameSlice =
      from[0] === to[0] &&
      (["app", "shared"].includes(from[0]) || from[1] === to[1]);
    if (!sameSlice && layers.indexOf(to[0]) <= layers.indexOf(from[0]))
      violations.push(
        `${label(file)}: forbidden ${from.slice(0, 2).join("/")} → ${to.slice(0, 2).join("/")}`,
      );
    if (
      !sameSlice &&
      !["app", "shared"].includes(to[0]) &&
      !(to.length === 3 && publicEntries.test(to[2]))
    )
      violations.push(
        `${label(file)}: use public API of ${to.slice(0, 2).join("/")}`,
      );
    if (to[0] === "shared") {
      const depth = ["api", "lib", "ui", "config"].includes(to[1]) ? 3 : 2;
      const sameUnit =
        from.slice(0, depth).join("/") === to.slice(0, depth).join("/");
      if (!sameUnit && !(to.length === depth + 1 && to.at(-1) === "index.ts"))
        violations.push(
          `${label(file)}: use public API of ${to.slice(0, depth).join("/")}`,
        );
    }
    sourceGraph.get(file).add(target);
    if (runtime) graph.get(file).add(target);
  }

  const sourceFiles = files(sourceRoot).sort();
  sourceFiles.forEach((file) => {
    graph.set(file, new Set());
    sourceGraph.set(file, new Set());
  });
  for (const file of sourceFiles) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    if (!layers.includes(label(file).split("/")[0]))
      violations.push(`${label(file)}: unknown FSD layer`);
    if (/@ts-(?:nocheck|ignore)\b/.test(source.text))
      violations.push(`${label(file)}: blanket TypeScript suppression`);
    function visit(node) {
      if (
        (ts.isImportEqualsDeclaration(node) &&
          ts.isExternalModuleReference(node.moduleReference)) ||
        (ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === "require")
      )
        violations.push(
          `${label(file)}: CommonJS require is unsupported; use explicit ESM imports`,
        );
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const clause = ts.isImportDeclaration(node) ? node.importClause : node;
        const named = ts.isImportDeclaration(node)
          ? clause?.namedBindings
          : node.exportClause;
        const onlyTypes =
          clause?.isTypeOnly ||
          (named &&
            "elements" in named &&
            named.elements.length > 0 &&
            named.elements.every((element) => element.isTypeOnly) &&
            !clause?.name);
        checkImport(file, node.moduleSpecifier.text, !onlyTypes);
      }
      if (ts.isExportDeclaration(node) && !node.exportClause)
        violations.push(
          `${label(file)}: export explicit public API names instead of wildcard exports`,
        );
      if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteral(node.argument.literal)
      )
        checkImport(file, node.argument.literal.text, false);
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword
      ) {
        const argument = node.arguments[0];
        if (argument && ts.isStringLiteral(argument))
          checkImport(file, argument.text);
        else {
          // One bootstrap loads the locally packaged ESM entry in Chrome's isolated world.
          const bootstrap =
            label(file) === "app/entrypoints/content_proxy.ts" &&
            argument &&
            ts.isCallExpression(argument) &&
            argument.expression.getText(source) === "chrome.runtime.getURL" &&
            argument.arguments.length === 1 &&
            ts.isStringLiteral(argument.arguments[0]) &&
            argument.arguments[0].text === "modules/content.js";
          if (!bootstrap)
            violations.push(
              `${label(file)}: dynamic imports must use a statically known local module`,
            );
        }
      }
      if (
        ts.isCallExpression(node) &&
        /^(?:setTimeout|setInterval|sleep)$|\.(?:setTimeout|setInterval|timeout|interval)$/.test(
          node.expression.getText(source),
        )
      ) {
        const delay =
          node.arguments[node.expression.getText(source) === "sleep" ? 0 : 1];
        if (
          delay &&
          (ts.isNumericLiteral(delay) || ts.isBinaryExpression(delay))
        )
          violations.push(`${label(file)}: give timer policy an explicit name`);
      }
      if (node.kind === ts.SyntaxKind.AnyKeyword)
        violations.push(
          `${label(file)}: explicit any is not a migration strategy`,
        );
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  const visited = new Set();
  const stack = [];
  const active = new Set();
  function visitDependency(file) {
    if (active.has(file)) {
      const cycle = stack
        .slice(stack.indexOf(file))
        .concat(file)
        .map(label)
        .join(" → ");
      violations.push(`Circular runtime dependency: ${cycle}`);
      return;
    }
    if (visited.has(file)) return;
    visited.add(file);
    active.add(file);
    stack.push(file);
    for (const dependency of graph.get(file) || []) visitDependency(dependency);
    stack.pop();
    active.delete(file);
  }
  sourceFiles.forEach(visitDependency);
  if (entryPoints) {
    const reachable = new Set();
    function visitSource(file) {
      if (reachable.has(file)) return;
      reachable.add(file);
      for (const dependency of sourceGraph.get(file)) visitSource(dependency);
    }
    for (const entry of entryPoints) {
      const file = resolve(sourceRoot, entry);
      if (!sourceGraph.has(file))
        violations.push(
          `${label(file)}: entry point is outside the checked source graph`,
        );
      else visitSource(file);
    }
    // Ambient declarations are included by tsconfig, without an explicit import.
    sourceFiles.filter((file) => file.endsWith(".d.ts")).forEach(visitSource);
    for (const file of sourceFiles)
      if (!reachable.has(file))
        violations.push(
          `${label(file)}: module is not reachable from extension entry points`,
        );
  }
  return violations;
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] || "")).href) {
  const violations = checkArchitecture(join(root, "src"), {
    entryPoints: [
      ...Object.values(scriptEntryPoints),
      ...Object.values(moduleEntryPoints),
    ].map((entry) => resolve(root, entry)),
  });
  if (violations.length) {
    console.error(violations.join("\n"));
    process.exitCode = 1;
  } else
    console.log(
      "FSD public APIs, runtime cycles, source reachability, timer policies and TypeScript source checks passed.",
    );
}
