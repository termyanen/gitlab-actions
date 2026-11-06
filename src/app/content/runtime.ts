import { createJiraState } from "../../entities/jira-issue";
import { startPageLayout } from "../../features/page-layout";
import { createSessionApi } from "../../shared/api/gitlab";
import { addRuntimeListener } from "../../shared/api/runtime";
import { ROUTE_POLL_INTERVAL_MS } from "../../shared/config/runtime";
import { errorMessage } from "../../shared/lib/errors";
import type { Lifecycle } from "../../shared/lib/lifecycle";
import { createLifecycle } from "../../shared/lib/lifecycle";
import type { createJiraPanel } from "../../widgets/jira-panel";
import type { startMrToolbar } from "../../widgets/mr-toolbar";
import { createTaskTracker } from "../../widgets/task-tracker";
const lifetime = createLifecycle();
const tracker = createTaskTracker(lifetime);
const jira = createJiraState();
const api = createSessionApi(() => location.origin);
lifetime.onCleanup(
  addRuntimeListener((message, _sender, sendResponse) => {
    if (message.type === "api-proxy") {
      api(message.method, message.path, message.body)
        .then(sendResponse)
        .catch((error: unknown) =>
          sendResponse({ _error: errorMessage(error) }),
        );
      return true;
    }
    if (message.type === "task-result")
      tracker.updateTrackerItem(
        message.taskId,
        message.jobs || [],
        message.success ? "done" : "error",
        message.success ? null : message.message,
        message.mrTitle,
      );
    if (message.type === "task-progress")
      tracker.updateTrackerItem(
        message.taskId,
        message.jobs,
        message.status,
        null,
        message.mrTitle,
      );
  }),
);
tracker.restoreActiveTasks();
startPageLayout(lifetime);

let route = "";
let pageScope: Lifecycle | undefined;
let reviewStarted = false;
let paletteStarted = false;
let paletteEnabled = false;
chrome.storage.sync.get(
  { show_cmd_palette: true },
  lifetime.guard((settings: { show_cmd_palette: boolean }) => {
    paletteEnabled = settings.show_cmd_palette;
  }),
);
let toolbar: ReturnType<typeof startMrToolbar> | undefined;
let standupOpen: (() => void) | undefined;
const fail = (error: unknown) => console.error("[GitLab Actions]", error);
lifetime.listen(
  document,
  "keydown",
  (event) => {
    if (
      !paletteEnabled ||
      paletteStarted ||
      !(event.metaKey || event.ctrlKey) ||
      event.key !== "k"
    )
      return;
    const paletteScope = pageScope;
    if (!paletteScope || paletteScope.disposed) return;
    event.preventDefault();
    paletteStarted = true;
    void import("../../widgets/command-palette")
      .then(({ startCommandPalette }) => {
        if (paletteScope.disposed) return;
        startCommandPalette(
          () => {
            void import("../../widgets/standup")
              .then(({ createStandupDialog }) => {
                if (!lifetime.disposed) {
                  standupOpen ||= createStandupDialog(lifetime).open;
                  standupOpen();
                }
              })
              .catch(fail);
          },
          paletteScope,
          true,
          {
            actions: () => toolbar?.getPaletteActions() || [],
            run: (id) => toolbar?.runPaletteAction(id),
          },
        );
      })
      .catch((error: unknown) => {
        if (pageScope === paletteScope) paletteStarted = false;
        fail(error);
      });
  },
  true,
);

function mountRoute() {
  const next = location.pathname;
  if (route === next) return;
  route = next;
  pageScope?.dispose();
  const scope = createLifecycle();
  pageScope = scope;
  const mr = /\/-\/merge_requests\/\d+/.test(next);
  const list = /\/-\/merge_requests\/?$/.test(next);
  const commits =
    /\/(?:-\/)?(?:commits|commit)\//.test(next) ||
    /\/-\/repository\/commits\//.test(next);
  const pipeline = /\/-\/pipelines\/\d+/.test(next);
  let panel: ReturnType<typeof createJiraPanel> | undefined;
  const openJira = (ticket: string, url: string) => {
    void import("../../widgets/jira-panel")
      .then(({ createJiraPanel }) => {
        if (scope.disposed) return;
        panel ||= createJiraPanel(jira, scope);
        panel.openJiraSidebar(ticket, url);
      })
      .catch(fail);
  };
  scope.onCleanup(() => {
    toolbar = undefined;
    paletteStarted = false;
    jira.invalidateCommitTicket = null;
    jira.fetching = false;
    jira.refreshPending = false;
    document
      .querySelectorAll(
        ".gl-mr-actions-ext, .gl-mr-actions-failed-jobs, .gl-mr-ext-git-commands, .gl-mr-ext-toolbar, .gl-cherry-pick-btn, .gl-cherry-pick-detail-btn, .gl-commit-version-badge, .gl-commit-version-loader, .gl-commit-jira-loader, .gl-cherry-pick-overlay, .gl-jira-sidebar, .gl-jira-lightbox, .gl-group-play-btn",
      )
      .forEach((node) => node.remove());
    document.body.classList.remove("gl-mr-ext-hide-right-sidebar");
    document
      .querySelectorAll(
        ".gl-jira-ticket-group, .gl-jira-ticket-sep, .gl-jira-badge, .gl-jira-list-icon, .gl-jira-loader, .gl-mr-ext-copy-li, .gl-reviewer-badge, .gl-mr-ext-threads-badge, .gl-mr-ext-size-badge, .gl-mr-ext-conflict-badge, .gl-mr-ext-branch-badge, .gl-mr-ext-branch-loader",
      )
      .forEach((node) => node.remove());
    document
      .querySelectorAll<HTMLElement>(
        "[data-gl-mr-enhanced], [data-gl-jira-badges], [data-gl-commit-jira-badges]",
      )
      .forEach((node) => {
        delete node.dataset.glMrEnhanced;
        delete node.dataset.glJiraBadges;
        delete node.dataset.glCommitJiraBadges;
        node.classList.remove("gl-mr-ext-dimmed", "gl-mr-ext-own");
      });
  });
  chrome.storage.sync.get(
    { hide_right_sidebar: false },
    scope.guard((settings: { hide_right_sidebar: boolean }) => {
      if (mr && settings.hide_right_sidebar)
        document.body.classList.add("gl-mr-ext-hide-right-sidebar");
    }),
  );
  if (mr) {
    void import("../../widgets/mr-toolbar")
      .then(({ startMrToolbar }) => {
        if (scope.disposed) return;
        toolbar = startMrToolbar(
          {
            origin: location.origin,
            projectId: null,
            mrIid: null,
            projectPath: null,
          },
          tracker,
          scope,
        );
      })
      .catch(fail);
  }
  if (mr || list)
    void import("../../widgets/mr-list")
      .then(({ startMrList }) => {
        if (!scope.disposed) startMrList(jira, openJira, mr, scope);
      })
      .catch(fail);
  if (commits)
    void import("../../widgets/commit-actions")
      .then((module) => {
        if (scope.disposed) return;
        module.startCommitJira(jira, openJira, scope);
        module.startCommitVersions(scope);
        module.startCommitCherryPick(
          (...args) => ({
            open: (...input) => {
              void import("../../widgets/cherry-pick-dialog")
                .then(({ createCherryPickDialog }) => {
                  if (!scope.disposed)
                    createCherryPickDialog(...args, scope).open(...input);
                })
                .catch(fail);
            },
          }),
          scope,
        );
      })
      .catch(fail);
  if (pipeline)
    void import("../../widgets/pipeline-actions")
      .then(({ startPipelineActions }) => {
        if (!scope.disposed) startPipelineActions(scope);
      })
      .catch(fail);
  if (!reviewStarted && /\/(?:merge_requests|issues|work_items)\//.test(next)) {
    reviewStarted = true;
    void import("./review")
      .then(({ startReview }) => {
        if (!lifetime.disposed) lifetime.onCleanup(startReview());
      })
      .catch((error: unknown) => {
        reviewStarted = false;
        fail(error);
      });
  }
}
mountRoute();
lifetime.listen(window, "popstate", mountRoute);
// Isolated worlds cannot observe page pushState directly. One low-frequency
// route check replaces the independent page initializers and polling loops.
lifetime.interval(mountRoute, ROUTE_POLL_INTERVAL_MS);
lifetime.listen(window, "pagehide", (event) => {
  if (!event.persisted) {
    pageScope?.dispose();
    lifetime.dispose();
  }
});
