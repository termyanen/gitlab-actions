import type { DisplayPreferences } from "../../../entities/settings";
const SENSITIVE_PATTERNS = [
  /^\.env(\..*)?$/i,
  /^Dockerfile(\..*)?$/i,
  /^docker-compose[^/]*\.ya?ml$/i,
  /^\.gitlab-ci\.yml$/i,
  /^\.github\/workflows\//i,
  /^Jenkinsfile$/i,
  /credentials/i,
  /secrets?\.(json|ya?ml|toml|xml|properties|cfg|conf|ini)$/i,
  /^\.ssh\//i,
  /^\.npmrc$/i,
  /^\.pypirc$/i,
  /^\.htpasswd$/i,
  /^\.pgpass$/i,
  /^id_rsa/i,
  /\.pem$/i,
  /\.key$/i,
];

// Glob matching without interpreting user input as a regular expression.
// A pattern without / targets the basename; * also spans / in path patterns.
function matchesGlob(value: string, pattern: string) {
  let v = 0,
    p = 0,
    star = -1,
    retry = 0;
  while (v < value.length) {
    if (pattern[p] === "?" || pattern[p] === value[v]) {
      v++;
      p++;
    } else if (pattern[p] === "*") {
      star = p++;
      retry = v;
    } else if (star >= 0) {
      p = star + 1;
      v = ++retry;
    } else return false;
  }
  while (pattern[p] === "*") p++;
  return p === pattern.length;
}
export function createSensitiveFileMatcher(settings: DisplayPreferences) {
  function patterns(value: string) {
    return value
      .split(/\r?\n/)
      .map((line) => line.trim().toLowerCase())
      .filter(Boolean);
  }
  const included = patterns(settings.sensitive_file_patterns);
  const excluded = patterns(settings.sensitive_file_exclusions);
  return (filepath: string) => {
    const path = filepath.toLowerCase();
    const name = path.replace(/^.*\//, "");
    function matches(pattern: string) {
      return matchesGlob(pattern.includes("/") ? path : name, pattern);
    }
    if (excluded.some(matches)) return false;
    return (
      included.some(matches) ||
      (settings.sensitive_file_defaults &&
        SENSITIVE_PATTERNS.some(
          (pattern) => pattern.test(name) || pattern.test(path),
        ))
    );
  };
}
