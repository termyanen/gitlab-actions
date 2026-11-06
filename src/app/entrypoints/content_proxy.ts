import { createJiraState } from "../../entities/jira-issue";
import { createJiraPanel } from "../../widgets/jira-panel";
import { startMrList } from "../../widgets/mr-list";
import {
  startCommitJira,
  startCommitVersions,
  startCommitCherryPick,
} from "../../widgets/commit-actions";
import { createCherryPickDialog } from "../../widgets/cherry-pick-dialog";
import { createStandupDialog } from "../../widgets/standup";
import { startCommandPalette } from "../../widgets/command-palette";
import { startPipelineActions } from "../../widgets/pipeline-actions";
import { startPageLayout } from "../../features/page-layout";
import { createTaskTracker } from "../../widgets/task-tracker";
import { createSessionApi } from "../../shared/api/gitlab";

if (document.querySelector('meta[content="GitLab"], body[data-page]')) {
  const state = createJiraState();
  const { openJiraSidebar } = createJiraPanel(state);
  const tracker = createTaskTracker();
  const api = createSessionApi(() => window.location.origin);
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (window.__glMrActionsLoaded) return;
    if (message.type === "api-proxy") {
      api(message.method, message.path, message.body)
        .then(sendResponse)
        .catch((error) => sendResponse({ _error: error.message }));
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
  });
  if (!window.__glMrActionsLoaded) tracker.restoreActiveTasks();
  startMrList(state, openJiraSidebar, !!window.__glMrActionsLoaded);
  startPageLayout();
  startCommitCherryPick(createCherryPickDialog);
  startCommitVersions();
  startCommitJira(state, openJiraSidebar);
  startPipelineActions();
  startCommandPalette(createStandupDialog().open);
}
