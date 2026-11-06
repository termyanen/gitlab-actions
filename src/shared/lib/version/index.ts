import { isRecord } from "../validation";
export function bumpVersion(version: string, strategy: string) {
  const parts = version.split(".");
  if (strategy === "minor" && parts.length < 2) parts.push("0");
  const changed =
    strategy === "major" ? 0 : strategy === "minor" ? 1 : parts.length - 1;
  return parts
    .map((part, index) =>
      index < changed
        ? part
        : index === changed
          ? String(parseInt(part) + 1)
          : "0",
    )
    .join(".");
}

export function getNestedValue(obj: unknown, path: string): unknown {
  let value = obj;
  for (const key of path.split(".")) {
    if (
      value === null ||
      typeof value !== "object" ||
      !Object.hasOwn(value, key)
    )
      return undefined;
    value = Reflect.get(value, key);
  }
  return value;
}

export function setNestedValue(obj: unknown, path: string, value: unknown) {
  if (obj === null || typeof obj !== "object")
    throw new Error("The version file must contain a JSON object or array");
  const keys = path.split(".");
  const last = keys.pop();
  if (last === undefined) throw new Error("Missing version field path");
  let target = obj;
  for (const key of keys) {
    let next: unknown = Object.hasOwn(target, key)
      ? Reflect.get(target, key)
      : undefined;
    if (next == null) {
      next = {};
      Object.defineProperty(target, key, {
        value: next,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    if (typeof next !== "object" || next === null)
      throw new Error("Invalid nested version field: " + key);
    target = next;
  }
  Object.defineProperty(target, last, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

export function parseToml(text: string): Record<string, unknown> {
  // Simple TOML parser — handles [section] and key = "value" patterns
  const result: Record<string, unknown> = {};
  let currentSection = result;
  const lines = text.split("\n");
  for (const sourceLine of lines) {
    const line = sourceLine.trim();
    if (!line || line[0] === "#") continue;
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch?.[1]) {
      const sectionPath = sectionMatch[1].split(".");
      currentSection = result;
      for (const key of sectionPath) {
        const next = Object.hasOwn(currentSection, key)
          ? currentSection[key]
          : undefined;
        if (isRecord(next)) {
          currentSection = next;
        } else {
          const section: Record<string, unknown> = {};
          Object.defineProperty(currentSection, key, {
            value: section,
            enumerable: true,
            configurable: true,
            writable: true,
          });
          currentSection = section;
        }
      }
      continue;
    }
    const kvMatch = line.match(/^([^=]+?)\s*=\s*"([^"]*)"$/);
    if (kvMatch?.[1] && kvMatch[2] !== undefined) {
      Object.defineProperty(currentSection, kvMatch[1].trim(), {
        value: kvMatch[2],
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }
  return result;
}

export function updateTomlVersion(
  text: string,
  path: string,
  newVersion: string,
) {
  // Update version in TOML text preserving formatting
  const keys = path.split(".");
  const versionKey = keys.pop();
  if (versionKey === undefined) throw new Error("Missing version field path");
  const sectionKeys = keys;
  const targetSection =
    sectionKeys.length > 0 ? "[" + sectionKeys.join(".") + "]" : null;

  const lines = text.split("\n");
  let inSection = targetSection === null;
  const regex = new RegExp(
    "^(\\s*" +
      versionKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
      '\\s*=\\s*)"[^"]*"',
  );

  for (const [i, line] of lines.entries()) {
    const trimmed = line.trim();
    if (trimmed.match(/^\[/)) {
      inSection = targetSection !== null && trimmed === targetSection;
    }
    if (inSection && regex.test(line)) {
      lines[i] = line.replace(regex, '$1"' + newVersion + '"');
      return lines.join("\n");
    }
  }
  throw new Error('Could not find "' + path + '" in TOML file');
}
