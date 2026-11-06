import type {
  JiraFieldUpdate,
  JiraQuickAction,
} from "../../../entities/jira-issue";
import type {
  CustomJob,
  MrAction,
  QuickComment,
} from "../../../entities/settings";
import {
  JIRA_ACTION_FIELDS,
  MR_ACTION_TYPES,
} from "../../../features/manage-settings";
import { requireElement } from "../../../shared/ui/dom";
import type { ButtonItem } from "../model/types";
import { byId, escHtml } from "./dom";
export function createActionEditors({
  t,
  scheduleAutoSave,
  getButtonOrderFromUI,
  renderButtonOrder,
  validateMrActions,
}: {
  t: (key: string) => string;
  scheduleAutoSave: () => void;
  getButtonOrderFromUI: (id: string) => ButtonItem[];
  renderButtonOrder: (items: ButtonItem[], id: string) => void;
  validateMrActions: (actions: unknown) => void;
}) {
  function renderCustomJobs(
    jobs: CustomJob[],
    listId: string,
    orderContainerId: string,
  ) {
    const list = byId(listId);
    if (!list) return;
    list.innerHTML = "";
    (jobs || []).forEach(function (job, i) {
      const row = document.createElement("div");
      row.className = "custom-job";
      row.innerHTML =
        '<input type="text" placeholder="Button label" value="' +
        escHtml(job.label || "") +
        '" data-field="label">' +
        '<input type="text" placeholder="Job name" value="' +
        escHtml(job.jobName || "") +
        '" data-field="jobName">' +
        '<span class="remove-btn" data-index="' +
        i +
        '">&times;</span>';
      list.appendChild(row);
    });

    list.querySelectorAll<HTMLElement>(".remove-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const idx = Number(btn.dataset.index);
        if (!Number.isSafeInteger(idx) || idx < 0) return;
        const current = getCustomJobsFromUI(listId);
        current.splice(idx, 1);
        renderCustomJobs(current, listId, orderContainerId);
        rebuildButtonOrderCustom(orderContainerId, listId);
      });
    });
  }
  function mrActionsSection(listId: string, addId: string, profile?: boolean) {
    return (
      '<div class="sep"></div><h4>' +
      escHtml(t("mrActions")) +
      "</h4>" +
      '<div class="hint">' +
      escHtml(t("mrActionsHint")) +
      "</div>" +
      (profile
        ? '<div class="hint">' + escHtml(t("mrActionsProfileHint")) + "</div>"
        : "") +
      '<div id="' +
      listId +
      '"></div><button type="button" class="add-btn" id="' +
      addId +
      '">+ ' +
      escHtml(t("mrActionAdd")) +
      "</button>"
    );
  }
  function getMrActionsFromUI(listId: string, validate?: boolean) {
    const actions: MrAction[] = [];
    document
      .querySelectorAll<HTMLElement>("#" + listId + " .mr-action")
      .forEach(function (row) {
        const type = requireElement(
          row.querySelector<HTMLSelectElement>('[data-field="type"]'),
        ).value;
        const id = row.dataset.id;
        if (!id) throw new Error(t("mrActionInvalid"));
        actions.push({
          id,
          label: requireElement(
            row.querySelector<HTMLInputElement>('[data-field="label"]'),
          ).value.trim(),
          type: type,
          labels: /^(remove|add|set)_labels$/.test(type)
            ? requireElement(
                row.querySelector<HTMLTextAreaElement>('[data-field="labels"]'),
              )
                .value.split(/[,\n]+/)
                .map(function (label) {
                  return label.trim();
                })
                .filter(Boolean)
                .filter(function (label, i, all) {
                  return all.indexOf(label) === i;
                })
                .join(", ")
            : "",
        });
      });
    if (validate) validateMrActions(actions);
    return actions;
  }
  function rebuildMrActionOrder(listId: string, orderId: string) {
    const actions = getMrActionsFromUI(listId);
    const items = getButtonOrderFromUI(orderId).filter(function (item) {
      return (
        item.key.indexOf("mr_action_") !== 0 ||
        actions.some(function (action) {
          return item.key === "mr_action_" + action.id;
        })
      );
    });
    actions.forEach(function (action) {
      const key = "mr_action_" + action.id;
      const item = items.find(function (it) {
        return it.key === key;
      });
      if (item) item.label = action.label || t("mrActions");
      else
        items.push({
          key: key,
          label: action.label || t("mrActions"),
          enabled: true,
          isCustom: true,
        });
    });
    renderButtonOrder(items, orderId);
  }
  function renderMrActions(
    actions: MrAction[],
    listId: string,
    orderId: string,
  ) {
    const list = byId(listId);
    list.innerHTML = "";
    actions.forEach(function (action) {
      const row = document.createElement("div");
      row.className = "mr-action";
      row.dataset.id = action.id;
      row.innerHTML =
        '<div class="mr-action-heading"><input type="text" data-field="label" aria-label="' +
        escHtml(t("mrActionLabel")) +
        '" placeholder="' +
        escHtml(t("mrActionLabel")) +
        '" value="' +
        escHtml(action.label || "") +
        '">' +
        '<button type="button" class="remove-btn" aria-label="' +
        escHtml(t("mrActionDelete")) +
        '">&times;</button></div>' +
        '<select data-field="type" aria-label="' +
        escHtml(t("mrActionType")) +
        '">' +
        MR_ACTION_TYPES.map(function (type) {
          return (
            '<option value="' +
            type +
            '">' +
            escHtml(t("mrAction_" + type)) +
            "</option>"
          );
        }).join("") +
        "</select>" +
        '<div class="mr-action-labels"><textarea rows="2" data-field="labels" aria-label="' +
        escHtml(t("mrActionLabels")) +
        '" placeholder="' +
        escHtml(t("mrActionLabels")) +
        '">' +
        escHtml(action.labels || "") +
        "</textarea>" +
        '<div class="hint">' +
        escHtml(t("mrActionLabelsHint")) +
        "</div></div>";
      list.appendChild(row);
      const select = requireElement(
        row.querySelector<HTMLSelectElement>('[data-field="type"]'),
      );
      select.value = action.type;
      function updateType() {
        requireElement(
          row.querySelector<HTMLElement>(".mr-action-labels"),
        ).hidden = !/^(remove|add|set)_labels$/.test(select.value);
      }
      updateType();
      select.addEventListener("change", updateType);
      requireElement(
        row.querySelector<HTMLInputElement>('[data-field="label"]'),
      ).addEventListener("input", function () {
        rebuildMrActionOrder(listId, orderId);
      });
      requireElement(
        row.querySelector<HTMLElement>(".remove-btn"),
      ).addEventListener("click", function () {
        const current = getMrActionsFromUI(listId).filter(function (item) {
          return item.id !== action.id;
        });
        renderMrActions(current, listId, orderId);
        rebuildMrActionOrder(listId, orderId);
        scheduleAutoSave();
      });
    });
  }
  function setupMrActions(
    actions: MrAction[],
    listId: string,
    addId: string,
    orderId: string,
  ) {
    renderMrActions(actions, listId, orderId);
    byId(addId).addEventListener("click", function () {
      const current = getMrActionsFromUI(listId);
      current.push({
        id: Date.now().toString(36) + "-" + Math.random().toString(36).slice(2),
        label: "",
        type: "remove_labels",
        labels: "",
      });
      renderMrActions(current, listId, orderId);
      rebuildMrActionOrder(listId, orderId);
      scheduleAutoSave();
    });
  }
  function renderJiraQuickActions(actions: JiraQuickAction[]) {
    const list = byId("jiraQuickActionsList");
    list.innerHTML = "";
    (actions || []).forEach(function (a) {
      addJiraQuickActionRow(a);
    });
  }
  function addJiraQuickActionRow(action: Partial<JiraQuickAction>) {
    const list = byId("jiraQuickActionsList");
    const row = document.createElement("div");
    row.className = "jira-quick-action";
    row.innerHTML =
      '<div class="jqa-row">' +
      '<input type="text" data-field="label" aria-label="' +
      escHtml(t("jiraQuickActionLabel")) +
      '" placeholder="' +
      escHtml(t("jiraQuickActionLabel")) +
      '" value="' +
      escHtml(action.label || "") +
      '">' +
      '<button type="button" class="remove-btn" aria-label="' +
      escHtml(t("jiraQuickActionRemove")) +
      '">&times;</button>' +
      "</div>" +
      '<div class="jqa-changes"></div>' +
      '<button type="button" class="add-btn jqa-add-field">+ ' +
      escHtml(t("jiraQuickActionAddField")) +
      "</button>";
    requireElement(
      row.querySelector<HTMLElement>(".remove-btn"),
    ).addEventListener("click", function () {
      row.remove();
      scheduleAutoSave();
    });
    requireElement(
      row.querySelector<HTMLElement>(".jqa-add-field"),
    ).addEventListener("click", function () {
      addJiraQuickActionField(row, {
        field: "labels",
        operation: "add",
        value: [],
      });
    });
    list.appendChild(row);
    if (action.status)
      addJiraQuickActionField(row, { field: "status", value: action.status });
    if (action.assignee)
      addJiraQuickActionField(row, {
        field: "assignee",
        value: action.assignee,
      });
    (action.updates || []).forEach(function (update: JiraFieldUpdate) {
      addJiraQuickActionField(row, update);
    });
    if (!action.status && !action.assignee && !(action.updates || []).length) {
      addJiraQuickActionField(row, { field: "status", value: "" });
    }
  }
  function addJiraQuickActionField(row: HTMLElement, update: JiraFieldUpdate) {
    const fieldRow = document.createElement("div");
    fieldRow.className = "jqa-change";
    fieldRow.innerHTML =
      '<div class="jqa-row">' +
      '<select data-part="field" aria-label="' +
      escHtml(t("jiraQuickActionField")) +
      '">' +
      JIRA_ACTION_FIELDS.map(function (f) {
        return '<option value="' + f[0] + '">' + escHtml(t(f[1])) + "</option>";
      }).join("") +
      "</select>" +
      '<select data-part="operation" aria-label="' +
      escHtml(t("jiraQuickActionOperation")) +
      '">' +
      '<option value="add">' +
      escHtml(t("jiraQuickActionAddValues")) +
      "</option>" +
      '<option value="remove">' +
      escHtml(t("jiraQuickActionRemoveValues")) +
      "</option>" +
      '<option value="set">' +
      escHtml(t("jiraQuickActionSetValues")) +
      "</option></select>" +
      '<button type="button" class="remove-btn" aria-label="' +
      escHtml(t("jiraQuickActionRemove")) +
      '">&times;</button></div>' +
      '<input data-part="custom" aria-label="' +
      escHtml(t("jiraQuickActionCustom")) +
      '" placeholder="customfield_12345">' +
      '<input data-part="value" aria-label="' +
      escHtml(t("jiraQuickActionValue")) +
      '">' +
      '<div class="hint jqa-value-hint"></div>';
    requireElement(row.querySelector<HTMLElement>(".jqa-changes")).appendChild(
      fieldRow,
    );
    const select = requireElement(
      fieldRow.querySelector<HTMLSelectElement>('[data-part="field"]'),
    );
    const custom = requireElement(
      fieldRow.querySelector<HTMLInputElement>('[data-part="custom"]'),
    );
    const operation = requireElement(
      fieldRow.querySelector<HTMLSelectElement>('[data-part="operation"]'),
    );
    const input = requireElement(
      fieldRow.querySelector<HTMLInputElement>('[data-part="value"]'),
    );
    select.value = /^customfield_\d+$/.test(update.field)
      ? "custom"
      : update.field;
    custom.value = select.value === "custom" ? update.field : "";
    operation.value = update.operation || "set";
    input.value =
      select.value === "custom"
        ? JSON.stringify(update.value)
        : Array.isArray(update.value)
          ? update.value.join(", ")
          : String(update.value || "");
    function updateControls() {
      const field = select.value;
      const multi = [
        "labels",
        "fixVersions",
        "versions",
        "components",
      ].includes(field);
      operation.hidden = !multi;
      custom.hidden = field !== "custom";
      input.placeholder =
        field === "duedate"
          ? "YYYY-MM-DD"
          : field === "assignee"
            ? "username"
            : "";
      requireElement(
        fieldRow.querySelector<HTMLElement>(".jqa-value-hint"),
      ).textContent = t(
        field === "custom"
          ? "jiraQuickActionCustomHint"
          : multi
            ? "jiraQuickActionListHint"
            : field === "status"
              ? "jiraQuickActionStatusHint"
              : "jiraQuickActionValueHint",
      );
    }
    select.addEventListener("change", function () {
      input.value = "";
      operation.value = "add";
      updateControls();
    });
    requireElement(
      fieldRow.querySelector<HTMLElement>(".remove-btn"),
    ).addEventListener("click", function () {
      fieldRow.remove();
      scheduleAutoSave();
    });
    updateControls();
  }
  function getJiraQuickActionsFromUI() {
    const rows = document.querySelectorAll<HTMLElement>(
      "#jiraQuickActionsList .jira-quick-action",
    );
    const actions: JiraQuickAction[] = [];
    rows.forEach(function (row) {
      const label = requireElement(
        row.querySelector<HTMLInputElement>('[data-field="label"]'),
      ).value.trim();
      const action: Required<
        Pick<JiraQuickAction, "label" | "status" | "assignee" | "updates">
      > = { label: label, status: "", assignee: "", updates: [] };
      const seen = new Set<string>();
      row
        .querySelectorAll<HTMLElement>(".jqa-change")
        .forEach(function (fieldRow) {
          let field = requireElement(
            fieldRow.querySelector<HTMLSelectElement>('[data-part="field"]'),
          ).value;
          const raw = requireElement(
            fieldRow.querySelector<HTMLInputElement>('[data-part="value"]'),
          ).value.trim();
          if (!raw) return;
          let value: unknown = raw;
          let operation = "set";
          if (field === "custom") {
            field = requireElement(
              fieldRow.querySelector<HTMLInputElement>('[data-part="custom"]'),
            ).value.trim();
            if (!/^customfield_\d+$/.test(field))
              throw new Error(t("jiraQuickActionInvalid"));
            try {
              value = JSON.parse(raw);
            } catch {
              throw new Error(t("jiraQuickActionInvalid"));
            }
          } else if (
            ["labels", "fixVersions", "versions", "components"].includes(field)
          ) {
            value = Array.from(
              new Set(
                raw
                  .split(",")
                  .map(function (v) {
                    return v.trim();
                  })
                  .filter(Boolean),
              ),
            );
            operation = requireElement(
              fieldRow.querySelector<HTMLSelectElement>(
                '[data-part="operation"]',
              ),
            ).value;
            if (!Array.isArray(value) || !value.length) return;
          } else if (
            field === "duedate" &&
            (!/^\d{4}-\d{2}-\d{2}$/.test(raw) ||
              isNaN(Date.parse(raw)) ||
              new Date(raw).toISOString().slice(0, 10) !== raw)
          ) {
            throw new Error(t("jiraQuickActionInvalid"));
          }
          if (seen.has(field)) throw new Error(t("jiraQuickActionDuplicate"));
          seen.add(field);
          if (field === "status" || field === "assignee")
            action[field] = String(value);
          else
            action.updates.push({
              field: field,
              operation: operation,
              value: value,
            });
        });
      if (label && (action.status || action.assignee || action.updates.length))
        actions.push(action);
    });
    return actions;
  }
  function renderQuickComments(comments: QuickComment[]) {
    const list = byId("quickCommentsList");
    list.innerHTML = "";
    (comments || []).forEach(function (c) {
      addQuickCommentRow(c.label || "", c.text || "");
    });
  }
  function addQuickCommentRow(label: string, text: string) {
    const list = byId("quickCommentsList");
    const row = document.createElement("div");
    row.className = "quick-comment-row";
    row.innerHTML =
      '<div class="jqa-row">' +
      '<input type="text" data-field="label" placeholder="LGTM" value="' +
      escHtml(label) +
      '" style="flex:1">' +
      '<span class="remove-btn" title="Remove">&times;</span>' +
      "</div>" +
      '<div class="jqa-row">' +
      '<input type="text" data-field="text" placeholder="Looks good to me!" value="' +
      escHtml(text) +
      '" style="width:100%">' +
      "</div>";
    requireElement(
      row.querySelector<HTMLElement>(".remove-btn"),
    ).addEventListener("click", function () {
      row.remove();
    });
    list.appendChild(row);
  }
  function getQuickCommentsFromUI() {
    const rows = document.querySelectorAll<HTMLElement>(
      "#quickCommentsList .quick-comment-row",
    );
    const comments: QuickComment[] = [];
    rows.forEach(function (row) {
      const label = requireElement(
        row.querySelector<HTMLInputElement>('[data-field="label"]'),
      ).value.trim();
      const text = requireElement(
        row.querySelector<HTMLInputElement>('[data-field="text"]'),
      ).value.trim();
      if (label && text) comments.push({ label: label, text: text });
    });
    return comments;
  }
  function renderCherryPickBranches(branches: string[]) {
    const list = byId("cherryPickBranchesList");
    list.innerHTML = "";
    (branches || []).forEach(function (b) {
      addCherryPickBranchRow(b);
    });
  }
  function addCherryPickBranchRow(branch: string) {
    const list = byId("cherryPickBranchesList");
    const row = document.createElement("div");
    row.className = "cherry-pick-branch-row";
    row.innerHTML =
      '<div class="jqa-row field">' +
      '<input type="text" data-field="branch" placeholder="test-branch" value="' +
      escHtml(branch) +
      '" style="flex:1">' +
      '<span class="remove-btn" title="Remove">&times;</span>' +
      "</div>";
    requireElement(
      row.querySelector<HTMLElement>(".remove-btn"),
    ).addEventListener("click", function () {
      row.remove();
    });
    list.appendChild(row);
  }
  function getCherryPickBranchesFromUI() {
    const rows = document.querySelectorAll<HTMLElement>(
      "#cherryPickBranchesList .cherry-pick-branch-row",
    );
    const branches: string[] = [];
    rows.forEach(function (row) {
      const branch = requireElement(
        row.querySelector<HTMLInputElement>('[data-field="branch"]'),
      ).value.trim();
      if (branch) branches.push(branch);
    });
    return branches;
  }
  function getCustomJobsFromUI(listId: string) {
    const rows = document.querySelectorAll<HTMLElement>(
      "#" + listId + " .custom-job",
    );
    const jobs: CustomJob[] = [];
    rows.forEach(function (row) {
      const label = requireElement(
        row.querySelector<HTMLInputElement>('[data-field="label"]'),
      ).value.trim();
      const jobName = requireElement(
        row.querySelector<HTMLInputElement>('[data-field="jobName"]'),
      ).value.trim();
      if (label || jobName) jobs.push({ label: label, jobName: jobName });
    });
    return jobs;
  }
  function rebuildButtonOrderCustom(orderContainerId: string, listId: string) {
    let items = getButtonOrderFromUI(orderContainerId);
    const customJobs = getCustomJobsFromUI(listId);
    items = items.filter(function (it) {
      return it.key.indexOf("custom_") !== 0;
    });
    customJobs.forEach(function (cj, i) {
      items.push({
        key: "custom_" + i,
        label: cj.label || cj.jobName || "Custom",
        enabled: true,
        isCustom: true,
      });
    });
    renderButtonOrder(items, orderContainerId);
  }
  return {
    renderCustomJobs,
    mrActionsSection,
    getMrActionsFromUI,
    rebuildMrActionOrder,
    renderMrActions,
    setupMrActions,
    renderJiraQuickActions,
    addJiraQuickActionRow,
    addJiraQuickActionField,
    getJiraQuickActionsFromUI,
    renderQuickComments,
    addQuickCommentRow,
    getQuickCommentsFromUI,
    renderCherryPickBranches,
    addCherryPickBranchRow,
    getCherryPickBranchesFromUI,
    getCustomJobsFromUI,
    rebuildButtonOrderCustom,
  };
}
