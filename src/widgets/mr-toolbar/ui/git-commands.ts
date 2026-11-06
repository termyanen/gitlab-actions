import type { ActiveMergeRequest } from "../../../entities/merge-request";
import type { Translate } from "../../../shared/i18n";
import type { Lifecycle } from "../../../shared/lib/lifecycle";
const COPIED_FEEDBACK_DURATION_MS = 2000;

export function createGitCommands(t: Translate, scope: Lifecycle) {
  // =========================================================================
  // Git command generator (#12)
  // =========================================================================

  function injectGitCommands(mr: ActiveMergeRequest) {
    if (scope.disposed) return;
    if (document.querySelector(".gl-mr-ext-git-commands")) return;

    const descBlock = document.querySelector(
      '.detail-page-description, .js-detail-page-description, [data-testid="description-content"], [data-testid="merge-request-description"]',
    );
    if (!descBlock) return;

    const branch = mr.source_branch;
    const wrapper = document.createElement("div");
    wrapper.className = "gl-mr-ext-git-commands";

    const commands = [
      {
        key: "gitCmdCheckout",
        cmd: "git fetch origin " + branch + " && git checkout " + branch,
      },
      {
        key: "gitCmdPull",
        cmd: "git checkout " + branch + " && git pull origin " + branch,
      },
      {
        key: "gitCmdReset",
        cmd:
          "git checkout " +
          branch +
          " && git fetch origin " +
          branch +
          " && git reset --hard origin/" +
          branch,
      },
    ];

    for (let i = 0; i < commands.length; i++) {
      (function (c) {
        const btn = document.createElement("button");
        btn.className = "gl-mr-ext-git-cmd-btn";
        btn.textContent = t(c.key);
        btn.title = c.cmd;
        btn.addEventListener("click", function () {
          copyToClipboard(c.cmd, btn);
        });
        wrapper.appendChild(btn);
      })(commands[i]);
    }

    descBlock.appendChild(wrapper);
  }

  function copyToClipboard(text: string, btn: HTMLButtonElement) {
    navigator.clipboard
      .writeText(text)
      .then(function () {
        const orig = btn.textContent;
        btn.textContent = "\u2713";
        scope.timeout(function () {
          btn.textContent = orig;
        }, COPIED_FEEDBACK_DURATION_MS);
      })
      .catch(function () {});
  }
  return { injectGitCommands };
}
