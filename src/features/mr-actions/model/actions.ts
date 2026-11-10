import { readActiveMergeRequest } from "../../../entities/merge-request";
import type { MrAction } from "../../../entities/settings";
import { createMrSettingsReader } from "../../../entities/settings";
import { createSessionApi } from "../../../shared/api/gitlab";
import { createMergeActions } from "./merge";
import { createPipelineActions } from "./pipeline";
import type { MrActionContext, MrActionUI, MrServices } from "./types";
import { createVersionActions } from "./version";
export function createMrActions(context: MrActionContext, ui: MrActionUI) {
  const { t, showToast } = ui;
  const api = createSessionApi(() => context.origin);
  const getSettings = createMrSettingsReader(() => context.projectPath);

  function getMR(includeRebase?: boolean) {
    return api(
      "GET",
      "/projects/" +
        context.projectId +
        "/merge_requests/" +
        context.mrIid +
        (includeRebase ? "?include_rebase_in_progress=true" : ""),
    ).then(readActiveMergeRequest);
  }

  function doCopyMr() {
    return getMR().then(function (mr) {
      const text = mr.title + "\n" + mr.web_url;
      return navigator.clipboard.writeText(text).then(function () {
        showToast(t("toastCopied"), "success", true);
      });
    });
  }

  // Each configurable action updates only its chosen field in one request.
  function doMrAction(action: MrAction) {
    return Promise.resolve().then(function () {
      if (!action || typeof action.label !== "string" || !action.label.trim())
        throw new Error(t("mrActionInvalid"));
      const body: Record<string, string | number | number[]> = {};
      const labelFields: Record<string, string> = {
        remove_labels: "remove_labels",
        add_labels: "add_labels",
        set_labels: "labels",
      };
      const labelField = labelFields[action.type];
      if (labelField) {
        if (typeof action.labels !== "string")
          throw new Error(t("mrActionInvalid"));
        let labels = action.labels
          .split(/[,\n]+/)
          .map(function (label) {
            return label.trim();
          })
          .filter(Boolean);
        labels = labels.filter(function (label, i) {
          return labels.indexOf(label) === i;
        });
        if (!labels.length) throw new Error(t("mrActionInvalid"));
        body[labelField] = labels.join(",");
      } else if (action.type === "clear_labels") body.labels = "";
      else if (action.type === "clear_assignees") body.assignee_ids = [0];
      else if (action.type === "clear_reviewers") body.reviewer_ids = [0];
      else if (action.type === "clear_milestone") body.milestone_id = 0;
      else throw new Error(t("mrActionInvalid"));
      return api(
        "PUT",
        "/projects/" + context.projectId + "/merge_requests/" + context.mrIid,
        body,
      );
    });
  }
  const services: MrServices = { ...ui, context, api, getMR, getSettings };
  const version = createVersionActions(services);
  return {
    api,
    getMR,
    getSettings,
    doCopyMr,
    doMrAction,
    ...version,
    ...createPipelineActions(services),
    ...createMergeActions(services, version),
  };
}
