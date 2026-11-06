export function bumpVersion(version: string, strategy: string) {
  const parts = version.split(".");
  if (strategy === "major") {
    parts[0] = String(parseInt(parts[0]) + 1);
    for (let i = 1; i < parts.length; i++) parts[i] = "0";
  } else if (strategy === "minor") {
    if (parts.length < 2) parts.push("0");
    parts[1] = String(parseInt(parts[1]) + 1);
    for (let i = 2; i < parts.length; i++) parts[i] = "0";
  } else {
    // patch (default)
    parts[parts.length - 1] = String(parseInt(parts[parts.length - 1]) + 1);
  }
  return parts.join(".");
}

export function getNestedValue(obj: unknown, path: string): unknown {
  const keys = path.split(".");
  let val = obj;
  for (let i = 0; i < keys.length; i++) {
    if (val == null) return undefined;
    val = (val as Record<string, unknown>)[keys[i]];
  }
  return val;
}

export function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
) {
  const keys = path.split(".");
  let target = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (target[keys[i]] == null) target[keys[i]] = {};
    target = target[keys[i]] as Record<string, unknown>;
  }
  target[keys[keys.length - 1]] = value;
}

export function parseToml(text: string): Record<string, unknown> {
  // Simple TOML parser — handles [section] and key = "value" patterns
  const result: Record<string, unknown> = {};
  let currentSection = result;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line[0] === "#") continue;
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      const sectionPath = sectionMatch[1].split(".");
      currentSection = result;
      for (let j = 0; j < sectionPath.length; j++) {
        if (!currentSection[sectionPath[j]])
          currentSection[sectionPath[j]] = {};
        currentSection = currentSection[sectionPath[j]] as Record<
          string,
          unknown
        >;
      }
      continue;
    }
    const kvMatch = line.match(/^([^=]+?)\s*=\s*"([^"]*)"$/);
    if (kvMatch) {
      currentSection[kvMatch[1].trim()] = kvMatch[2];
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
  const versionKey = keys[keys.length - 1];
  const sectionKeys = keys.slice(0, -1);
  const targetSection =
    sectionKeys.length > 0 ? "[" + sectionKeys.join(".") + "]" : null;

  const lines = text.split("\n");
  let inSection = targetSection === null;
  const regex = new RegExp(
    "^(\\s*" +
      versionKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
      '\\s*=\\s*)"[^"]*"',
  );

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.match(/^\[/)) {
      inSection = targetSection !== null && trimmed === targetSection;
    }
    if (inSection && regex.test(lines[i])) {
      lines[i] = lines[i].replace(regex, '$1"' + newVersion + '"');
      return lines.join("\n");
    }
  }
  throw new Error('Could not find "' + path + '" in TOML file');
}
