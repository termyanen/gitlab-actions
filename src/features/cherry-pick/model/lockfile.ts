import { getNestedValue, setNestedValue } from "../../../shared/lib/version";
import { isRecord } from "../../../shared/lib/validation";

export function companionLockfile(file: string, field: string) {
  if (field !== "version" || !/(^|\/)package\.json$/.test(file))
    return undefined;
  return file.replace(/package\.json$/, "package-lock.json");
}

function readLock(content: string) {
  const json: unknown = JSON.parse(content);
  if (!isRecord(json) || typeof json.version !== "string")
    throw new Error("Invalid package-lock.json root version");
  const root = isRecord(json.packages) ? json.packages[""] : undefined;
  if (
    root !== undefined &&
    (!isRecord(root) || typeof root.version !== "string")
  )
    throw new Error('Invalid package-lock.json packages[""] version');
  return { json, root: isRecord(root) ? root : undefined };
}

export function bumpLockfile(content: string, next: string) {
  const { json, root } = readLock(content);
  // package.json is authoritative; stale package versions in the lockfile
  // are synchronized without modifying dependency versions or metadata.
  json.version = next;
  if (root) root.version = next;
  return JSON.stringify(json, null, 2) + "\n";
}

function equalJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right))
    return (
      left.length === right.length &&
      left.every((value: unknown, index) => equalJson(value, right[index]))
    );
  if (!isRecord(left) || !isRecord(right)) return false;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) => Object.hasOwn(right, key) && equalJson(left[key], right[key]),
    )
  );
}

function mergeJson(parent: unknown, source: unknown, target: unknown): unknown {
  if (equalJson(parent, source)) return target;
  if (equalJson(parent, target) || equalJson(source, target)) return source;
  if (!isRecord(parent) || !isRecord(source) || !isRecord(target))
    throw new Error("Conflicting non-version changes in package-lock.json");
  const entries: [string, unknown][] = [];
  for (const key of new Set([
    ...Object.keys(parent),
    ...Object.keys(source),
    ...Object.keys(target),
  ])) {
    const own = (record: Record<string, unknown>) =>
      Object.hasOwn(record, key) ? record[key] : undefined;
    const value = mergeJson(own(parent), own(source), own(target));
    if (value !== undefined) entries.push([key, value]);
  }
  return Object.fromEntries(entries);
}

/** Three-way merge: ignore only the package's own versions, never dependency versions. */
export function mergeLockfile(parent: string, source: string, target: string) {
  const before = readLock(parent);
  const after = readLock(source);
  const destination = readLock(target);
  if (!!before.root !== !!after.root || !!before.root !== !!destination.root)
    throw new Error("Incompatible package-lock.json structure");
  after.json.version = before.json.version;
  if (after.root && before.root) after.root.version = before.root.version;
  const merged = mergeJson(before.json, after.json, destination.json);
  return equalJson(merged, destination.json)
    ? target
    : JSON.stringify(merged, null, 2) + "\n";
}

export function mergeVersionJson(
  parent: string,
  source: string,
  target: string,
  path: string,
) {
  const before: unknown = JSON.parse(parent);
  const after: unknown = JSON.parse(source);
  const destination: unknown = JSON.parse(target);
  const version = getNestedValue(before, path);
  if (
    typeof version !== "string" ||
    typeof getNestedValue(after, path) !== "string" ||
    typeof getNestedValue(destination, path) !== "string"
  )
    throw new Error("Missing version at " + path);
  setNestedValue(after, path, version);
  const merged = mergeJson(before, after, destination);
  return equalJson(merged, destination)
    ? target
    : JSON.stringify(merged, null, 2) + "\n";
}
