import { isRecord } from "../../../shared/lib/validation";
import { REVIEW_FILE_FILTER_MAX_LENGTH } from "./limits";
import type { FileFilter, ReviewFile } from "./types";
export const FILTER_FIELDS = [
  "includeExtensions",
  "includeFiles",
  "ignoreFiles",
  "ignoreDirs",
] as const;
export const DEFAULT_FILTER: FileFilter = {
  includeExtensions: "",
  includeFiles: "",
  ignoreFiles: "",
  ignoreDirs: "",
};

export function normalizeFilter(value?: unknown): FileFilter {
  const result = { ...DEFAULT_FILTER };
  const input = isRecord(value) ? value : undefined;
  FILTER_FIELDS.forEach((key) => {
    const text = input && input[key];
    if (text != null && typeof text !== "string")
      throw new Error("File filters must be text.");
    result[key] = (text || "").trim();
    if (result[key].length > REVIEW_FILE_FILTER_MAX_LENGTH)
      throw new Error("Each file filter must be at most 1500 characters.");
  });
  if (new TextEncoder().encode(JSON.stringify(result)).length + 21 > 8192)
    throw new Error("File filters exceed the settings storage limit.");
  return result;
}

export function patterns(text: string) {
  return text
    .split(/[\n,]/)
    .map(function (line) {
      return line.replace(/#.*$/, "").trim();
    })
    .filter(Boolean);
}
function pattern(raw: string) {
  let value = raw.replace(/\\/g, "/").replace(/\/+$/, "");
  const rooted = value.indexOf("/") >= 0;
  value = value.replace(/^\/+/, "");
  if (!value)
    return function () {
      return false;
    };
  if (!rooted) value = "**/" + value;
  // Memoized wildcard matching avoids pathological regular-expression backtracking.
  return function (path: string) {
    const memo = new Map<string, boolean>();
    function match(i: number, j: number): boolean {
      const key = i + ":" + j;
      const cached = memo.get(key);
      if (cached !== undefined) return cached;
      let result;
      if (i === value.length) result = j === path.length;
      else if (value.slice(i, i + 3) === "**/") {
        result = match(i + 3, j);
        for (let end = j; !result && end < path.length; end++)
          if (path[end] === "/") result = match(i + 3, end + 1);
      } else if (value.slice(i, i + 2) === "**")
        result = match(i + 2, j) || (j < path.length && match(i, j + 1));
      else if (value[i] === "*")
        result =
          match(i + 1, j) ||
          (j < path.length && path[j] !== "/" && match(i, j + 1));
      else
        result =
          j < path.length &&
          (value[i] === path[j] || (value[i] === "?" && path[j] !== "/")) &&
          match(i + 1, j + 1);
      memo.set(key, result);
      return result;
    }
    return match(0, 0);
  };
}
export function filterFiles<T extends ReviewFile>(files: T[], input?: unknown) {
  const config = normalizeFilter(input);
  const included: T[] = [];
  const excluded: { path: string; old_path?: string; reason: string }[] = [];
  const extensions = patterns(config.includeExtensions).map(function (ext) {
    return "." + ext.replace(/^\*?\.?/, "");
  });
  const include = patterns(config.includeFiles).map(pattern),
    ignore = patterns(config.ignoreFiles).map(pattern),
    dirs = patterns(config.ignoreDirs).map(pattern);
  files.forEach(function (file) {
    const paths = [
      file.deleted_file ? file.old_path : file.new_path,
      file.old_path,
    ].filter(function (path, index, all): path is string {
      return (
        typeof path === "string" &&
        !!path &&
        path !== "/dev/null" &&
        all.indexOf(path) === index
      );
    });
    const blocked = paths.some(function (path) {
      return (
        ignore.some(function (test) {
          return test(path);
        }) ||
        path
          .split("/")
          .slice(0, -1)
          .some(function (_, index, parts) {
            const dir = parts.slice(0, index + 1).join("/");
            return dirs.some(function (test) {
              return test(dir);
            });
          })
      );
    });
    const path = paths[0] || "";
    const keep =
      path &&
      !blocked &&
      ((!extensions.length && !include.length) ||
        extensions.some(function (ext) {
          return path.endsWith(ext);
        }) ||
        include.some(function (test) {
          return test(path);
        }));
    if (keep) included.push(file);
    else
      excluded.push({
        path: path,
        ...(file.old_path === undefined ? {} : { old_path: file.old_path }),
        reason: blocked ? "explicit exclusion" : "outside include lists",
      });
  });
  return { included: included, excluded: excluded, config: config };
}
