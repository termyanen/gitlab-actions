import { GITLAB_PAGE_SIZE } from "../../../shared/config/gitlab";
import type { ActiveMergeRequest } from "../../../entities/merge-request";
import type {
  createMrActions,
  MrActionContext,
} from "../../../features/mr-actions";
import type { Translate } from "../../../shared/i18n";
import type { Lifecycle } from "../../../shared/lib/lifecycle";
// =========================================================================
// Sensitive file warning (#13)
// =========================================================================

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
export function createSensitiveWarning(
  context: MrActionContext,
  api: ReturnType<typeof createMrActions>["api"],
  scope: Lifecycle,
  parsePage: () => boolean,
  t: Translate,
) {
  function isSensitiveFile(filepath: string) {
    const name = filepath.replace(/^.*\//, "");
    for (let i = 0; i < SENSITIVE_PATTERNS.length; i++) {
      if (
        SENSITIVE_PATTERNS[i].test(name) ||
        SENSITIVE_PATTERNS[i].test(filepath)
      )
        return true;
    }
    return false;
  }

  function injectSensitiveWarning(_mr: ActiveMergeRequest) {
    if (scope.disposed) return;
    if (document.querySelector(".gl-mr-ext-sensitive-warning")) return;

    api<{ new_path: string; old_path: string }[]>(
      "GET",
      "/projects/" +
        context.projectId +
        "/merge_requests/" +
        context.mrIid +
        "/diffs?per_page=" +
        GITLAB_PAGE_SIZE,
    )
      .then(function (diffs) {
        if (scope.disposed || !parsePage()) return;
        if (!diffs || !diffs.length) return;
        const sensitiveFiles = [];
        for (let i = 0; i < diffs.length; i++) {
          const path = diffs[i].new_path || diffs[i].old_path;
          if (path && isSensitiveFile(path)) {
            sensitiveFiles.push(path);
          }
        }
        if (!sensitiveFiles.length) return;
        if (document.querySelector(".gl-mr-ext-sensitive-warning")) return;

        const container = document.querySelector(".gl-mr-actions-ext");
        if (!container) return;

        const badge = document.createElement("span");
        badge.className = "gl-mr-ext-sensitive-warning";
        badge.textContent = t("sensitiveWarningBadge", [sensitiveFiles.length]);
        badge.title =
          t("sensitiveWarningHint") + "\n" + sensitiveFiles.join("\n");
        container.insertBefore(badge, container.firstChild);
      })
      .catch(function () {});
  }
  return { injectSensitiveWarning };
}
