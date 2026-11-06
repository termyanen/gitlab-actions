import { escHtml } from "../../../shared/lib/html";
interface TaskStatus {
  taskId: string;
  jobs: string[];
  status: string;
  error?: string;
  mrTitle?: string;
}
export function createTaskTracker() {
  // =========================================================================
  // Background tasks tracker panel
  // =========================================================================

  function getTrackerFab() {
    let fab = document.querySelector<HTMLButtonElement>(".gl-mr-actions-fab");
    if (fab) return fab;

    fab = document.createElement("button");
    fab.className = "gl-mr-actions-fab";
    fab.textContent = "Jobs";
    fab.addEventListener("click", function () {
      const panel = document.querySelector<HTMLDivElement>(
        ".gl-mr-actions-tracker",
      );
      if (panel) {
        panel.classList.remove("tracker-collapsed");
        fab.classList.remove("fab-visible");
      }
    });
    document.body.appendChild(fab);
    return fab;
  }

  function getTrackerPanel() {
    let panel = document.querySelector<HTMLDivElement>(
      ".gl-mr-actions-tracker",
    );
    if (panel) return panel;

    panel = document.createElement("div");
    panel.className = "gl-mr-actions-tracker";

    const header = document.createElement("div");
    header.className = "tracker-header";
    header.innerHTML =
      '<span class="tracker-title">Background Jobs</span><div class="tracker-header-actions"><button class="tracker-clear">Clear</button><button class="tracker-close" aria-label="Close">&times;</button></div>';
    header
      .querySelector(".tracker-close")!
      .addEventListener("click", function () {
        panel.classList.add("tracker-collapsed");
        getTrackerFab().classList.add("fab-visible");
      });
    header
      .querySelector(".tracker-clear")!
      .addEventListener("click", function () {
        const items = panel.querySelectorAll(
          ".tracker-item.done, .tracker-item.failed",
        );
        items.forEach(function (el) {
          el.remove();
        });
        if (!panel.querySelector(".tracker-item")) {
          panel.classList.add("tracker-collapsed");
        }
      });
    panel.appendChild(header);

    const list = document.createElement("div");
    list.className = "tracker-list";
    panel.appendChild(list);

    document.body.appendChild(panel);
    getTrackerFab();
    return panel;
  }

  function cancelTask(taskId: string | null) {
    chrome.runtime.sendMessage(
      { type: "cancel-task", taskId: taskId },
      function () {},
    );
  }

  function updateTrackerItem(
    taskId: string,
    jobNames: string[],
    currentStatus: string,
    error?: string | null,
    mrTitle?: string,
  ) {
    const panel = getTrackerPanel();
    panel.classList.remove("tracker-collapsed");
    getTrackerFab().classList.remove("fab-visible");
    const list = panel.querySelector<HTMLDivElement>(".tracker-list")!;

    let item = list.querySelector<HTMLDivElement>(
      '[data-task-id="' + taskId + '"]',
    );
    if (!item) {
      item = document.createElement("div");
      item.className = "tracker-item";
      item.setAttribute("data-task-id", taskId);
      list.appendChild(item);
    }

    let currentJob = "";
    const statusMatch = currentStatus.match(/^running:\s*(.+)$/);
    if (statusMatch) currentJob = statusMatch[1];

    const isDone = currentStatus === "done";
    const isError = currentStatus === "error";
    const isRunning = !isDone && !isError;

    const stepsHtml = jobNames
      .map(function (name, i) {
        let cls = "step";
        if (isDone) {
          cls += " step-done";
        } else if (isError && name === currentJob) {
          cls += " step-error";
        } else if (name === currentJob) {
          cls += " step-active";
        } else {
          const currentIdx = jobNames.indexOf(currentJob);
          if (currentIdx >= 0 && i < currentIdx) {
            cls += " step-done";
          }
        }
        return '<span class="' + cls + '">' + escHtml(name) + "</span>";
      })
      .join('<span class="step-arrow">\u2192</span>');

    const statusIcon = isDone
      ? "\u2713"
      : isError
        ? "\u2717"
        : '<span class="tracker-spinner"></span>';
    const statusCls = isDone
      ? "tracker-success"
      : isError
        ? "tracker-error"
        : "tracker-running";

    const cancelHtml = isRunning
      ? '<button class="tracker-cancel" aria-label="Cancel" data-cancel-id="' +
        taskId +
        '">&times;</button>'
      : "";

    const titleHtml = mrTitle
      ? '<div class="tracker-mr-title">' + escHtml(mrTitle) + "</div>"
      : "";

    item.innerHTML =
      titleHtml +
      '<div class="tracker-row"><span class="tracker-icon ' +
      statusCls +
      '">' +
      statusIcon +
      '</span><div class="tracker-steps">' +
      stepsHtml +
      "</div>" +
      cancelHtml +
      "</div>" +
      (isError && error
        ? '<div class="tracker-error-msg">' + escHtml(error) + "</div>"
        : "");

    if (isDone || isError) {
      item.className = "tracker-item " + (isDone ? "done" : "failed");
    }

    const cancelBtn = item.querySelector(".tracker-cancel");
    if (cancelBtn) {
      cancelBtn.addEventListener("click", function () {
        cancelTask(cancelBtn.getAttribute("data-cancel-id"));
      });
    }
  }

  function restoreActiveTasks() {
    if (
      typeof chrome === "undefined" ||
      !chrome.runtime ||
      !chrome.runtime.sendMessage
    )
      return;
    chrome.runtime.sendMessage(
      { type: "get-active-tasks" },
      function (tasks: TaskStatus[]) {
        if (chrome.runtime.lastError || !tasks || !tasks.length) return;
        tasks.forEach(function (t: TaskStatus) {
          updateTrackerItem(t.taskId, t.jobs, t.status, null, t.mrTitle);
          pollTaskStatus(t.taskId, t.jobs, t.mrTitle);
        });
      },
    );
  }

  function pollTaskStatus(
    taskId: string,
    jobNames: string[],
    mrTitle?: string,
  ) {
    const interval = setInterval(function () {
      chrome.runtime.sendMessage(
        { type: "get-task-status", taskId: taskId },
        function (resp: TaskStatus) {
          if (
            chrome.runtime.lastError ||
            !resp ||
            resp.status === "not_found"
          ) {
            clearInterval(interval);
            return;
          }
          updateTrackerItem(taskId, jobNames, resp.status, resp.error, mrTitle);
          if (resp.status === "done" || resp.status === "error") {
            clearInterval(interval);
          }
        },
      );
    }, 10000);
  }
  return { updateTrackerItem, restoreActiveTasks, pollTaskStatus };
}
