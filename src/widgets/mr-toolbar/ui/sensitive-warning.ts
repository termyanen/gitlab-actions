import type { MrSettings } from "../../../entities/settings";
import { GITLAB_PAGE_SIZE } from "../../../shared/config/gitlab";
import { reportError } from "../../../shared/lib/errors";
import {
  arrayOf,
  decoder,
  isString,
  objectOf,
} from "../../../shared/lib/validation";
import { createSensitiveFileMatcher } from "../model/sensitive-files";
const readDiffPaths = decoder(
  arrayOf(
    objectOf<{ new_path: string; old_path: string }[][number]>({
      new_path: isString,
      old_path: isString,
    }),
  ),
  "GitLab/Jira response",
);

import type {
  MrActionContext,
  createMrActions,
} from "../../../features/mr-actions";
import type { Translate } from "../../../shared/i18n";
import type { Lifecycle } from "../../../shared/lib/lifecycle";
const SENSITIVE_SCAN_MAX_PAGES = 10;
// =========================================================================
// Sensitive file warning (#13)
// =========================================================================

export function createSensitiveWarning(
  context: MrActionContext,
  api: ReturnType<typeof createMrActions>["api"],
  scope: Lifecycle,
  parsePage: () => boolean,
  t: Translate,
) {
  let pending = false;

  function injectSensitiveWarning(settings: MrSettings) {
    if (scope.disposed || pending) return;
    if (document.querySelector(".gl-mr-ext-sensitive-warning")) return;

    const isSensitiveFile = createSensitiveFileMatcher(settings);
    const sensitiveFiles = new Set<string>();
    let incomplete = false;
    pending = true;
    async function scan() {
      for (let page = 1; page <= SENSITIVE_SCAN_MAX_PAGES; page++) {
        if (scope.disposed) return;
        const diffs = await api(
          "GET",
          "/projects/" +
            context.projectId +
            "/merge_requests/" +
            context.mrIid +
            "/diffs?per_page=" +
            GITLAB_PAGE_SIZE +
            "&page=" +
            page,
        ).then(readDiffPaths);
        for (const diff of diffs) {
          if (
            (diff.new_path && isSensitiveFile(diff.new_path)) ||
            (diff.old_path && isSensitiveFile(diff.old_path))
          )
            sensitiveFiles.add(diff.new_path || diff.old_path);
        }
        if (diffs.length < GITLAB_PAGE_SIZE) return;
      }
      incomplete = true;
    }
    scan()
      .catch(() => {
        incomplete = true;
      })
      .then(function () {
        if (scope.disposed || !parsePage()) return;
        if (!sensitiveFiles.size && !incomplete) return;
        if (document.querySelector(".gl-mr-ext-sensitive-warning")) return;

        const container = document.querySelector(".gl-mr-actions-ext");
        if (!container) return;

        const badge = document.createElement("span");
        badge.className = "gl-mr-ext-sensitive-warning";
        badge.textContent = incomplete
          ? t("sensitiveScanIncomplete")
          : t("sensitiveWarningBadge", [sensitiveFiles.size]);
        badge.title =
          (incomplete
            ? t("sensitiveScanIncompleteHint", [
                SENSITIVE_SCAN_MAX_PAGES * GITLAB_PAGE_SIZE,
              ])
            : t("sensitiveWarningHint")) +
          "\n" +
          [...sensitiveFiles].join("\n");
        container.insertBefore(badge, container.firstChild);
        if (container instanceof HTMLElement)
          container.style.removeProperty("display");
      })
      .catch(reportError)
      .finally(() => {
        pending = false;
      });
  }
  return { injectSensitiveWarning };
}
