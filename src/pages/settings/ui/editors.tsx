import { useLayoutEffect, useRef, useState } from "react";
import {
  BUILTIN_BUTTONS,
  JIRA_ACTION_FIELDS,
  MR_ACTION_TYPES,
} from "../../../features/manage-settings";
import { SettingsButton } from "../../../shared/ui/settings";
import type { SettingsDraft } from "../model/draft";
import {
  orderedKeys,
  setButtonEnabled,
  inheritProjectSetting,
} from "../model/draft";
import {
  createJiraActionDraft,
  createJiraFieldDraft,
  isJiraListField,
} from "../model/jira-actions";
import type { JiraFieldDraft } from "../model/jira-actions";

interface EditorProps {
  draft: SettingsDraft;
  update: (draft: SettingsDraft) => void;
  t: (key: string, substitutions?: string[]) => string;
  profile?: boolean;
}

type RowKind = "jobs" | "comments" | "branches";
function rowKeys(draft: SettingsDraft, kind: RowKind) {
  return draft.rowKeys?.[kind] || draft[kind].map((_row, i) => `${kind}-${i}`);
}
function withRowKeys(draft: SettingsDraft, kind: RowKind, keys: string[]) {
  return {
    ...draft,
    rowKeys: {
      jobs: rowKeys(draft, "jobs"),
      comments: rowKeys(draft, "comments"),
      branches: rowKeys(draft, "branches"),
      [kind]: keys,
    },
  };
}

/** Keep persisted custom_N keys aligned with the remaining job buttons. */
function withoutJob(draft: SettingsDraft, index: number) {
  const order = draft.order.flatMap((key) => {
    const match = /^custom_(\d+)$/.exec(key);
    if (!match) return [key];
    const position = Number(match[1]);
    if (position === index) return [];
    return [`custom_${position > index ? position - 1 : position}`];
  });
  return withRowKeys(
    { ...draft, order, jobs: draft.jobs.filter((_job, i) => i !== index) },
    "jobs",
    rowKeys(draft, "jobs").filter((_key, i) => i !== index),
  );
}

export function ButtonOrder({ draft, update, t, profile }: EditorProps) {
  const container = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<string | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  useLayoutEffect(() => {
    const key = pendingFocus.current;
    if (!key) return;
    pendingFocus.current = null;
    const row = Array.from(container.current?.children || []).find(
      (node) => node instanceof HTMLElement && node.dataset.key === key,
    );
    (
      row?.querySelector<HTMLInputElement>("input:not(:disabled)") ||
      row?.querySelector<HTMLButtonElement>("button:not(:disabled)")
    )?.focus();
  }, [draft.order]);
  const items = [
    ...BUILTIN_BUTTONS.map((button) => ({
      key: button.key,
      label: t(button.labelKey),
      hint: t(button.hintKey),
      custom: false,
      enabled: draft.fields[button.key] === true,
    })),
    ...draft.jobs.map((job, index) => ({
      key: `custom_${index}`,
      label: job.label || job.jobName || t("mrActionLabel"),
      hint: "",
      custom: true,
      enabled: job.enabled !== false,
    })),
    ...draft.actions.map((action) => ({
      key: `mr_action_${action.id}`,
      label: action.label || t("mrActions"),
      hint: "",
      custom: true,
      enabled: action.enabled !== false,
    })),
  ];
  const keys = orderedKeys(draft);
  const ordered = keys.flatMap((key) => {
    const item = items.find((candidate) => candidate.key === key);
    return item ? [item] : [];
  });
  function move(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || to >= keys.length) return;
    const order = [...keys];
    const [key] = order.splice(from, 1);
    if (!key) return;
    order.splice(to, 0, key);
    pendingFocus.current = key;
    update({ ...draft, order });
  }
  return (
    <div id={profile ? "profileButtonOrder" : "buttonOrder"} ref={container}>
      {ordered.map((item, index) => (
        <div
          key={item.key}
          className={`btn-item${dragged === item.key ? " dragging" : ""}${over === item.key && dragged !== item.key ? " drag-over" : ""}`}
          data-key={item.key}
          draggable
          title={item.hint}
          onDragStart={(event) => {
            setDragged(item.key);
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", item.key);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setOver(item.key);
          }}
          onDragLeave={() => setOver(null)}
          onDragEnd={() => {
            setDragged(null);
            setOver(null);
          }}
          onDrop={(event) => {
            event.preventDefault();
            if (dragged) move(keys.indexOf(dragged), index);
            setDragged(null);
            setOver(null);
          }}
        >
          <span className="btn-drag-handle" aria-hidden="true">
            ☰
          </span>
          <input
            type="checkbox"
            aria-label={item.label}
            checked={item.enabled}
            onChange={(event) =>
              update(
                setButtonEnabled(draft, item.key, event.currentTarget.checked),
              )
            }
          />
          <span
            className={`btn-label${item.custom ? " custom-label" : ""}`}
            onClick={() =>
              update(setButtonEnabled(draft, item.key, !item.enabled))
            }
          >
            {item.label}
          </span>
          {profile && !item.custom && draft.legacyKeys?.includes(item.key) && (
            <SettingsButton
              className="inherit-reset"
              icon="reset"
              title={`${t("settingsUseGlobal")}: ${item.label}`}
              aria-label={`${t("settingsUseGlobal")}: ${item.label}`}
              onClick={() => update(inheritProjectSetting(draft, item.key))}
            >
              {t("settingsUseGlobal")}
            </SettingsButton>
          )}
          <div className="btn-arrows">
            {[-1, 1].map((direction) => (
              <SettingsButton
                key={direction}
                aria-label={`${t(direction < 0 ? "settingsMoveUp" : "settingsMoveDown")}: ${item.label}`}
                disabled={
                  index + direction < 0 || index + direction >= ordered.length
                }
                onClick={() => move(index, index + direction)}
              >
                {direction < 0 ? "↑" : "↓"}
              </SettingsButton>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function CustomJobsEditor({ draft, update, t, profile }: EditorProps) {
  const keys = rowKeys(draft, "jobs");
  return (
    <>
      <div id={profile ? "profileCustomJobsList" : "customJobsList"}>
        {draft.jobs.map((job, index) => (
          <div className="custom-job" key={keys[index]}>
            <input
              type="text"
              data-field="label"
              aria-label={t("mrActionLabel")}
              placeholder={t("mrActionLabel")}
              value={job.label}
              onChange={(event) =>
                update({
                  ...draft,
                  jobs: draft.jobs.map((item, i) =>
                    i === index
                      ? { ...item, label: event.currentTarget.value }
                      : item,
                  ),
                })
              }
            />
            <input
              type="text"
              data-field="jobName"
              aria-label={t("jobName")}
              placeholder={t("jobName")}
              value={job.jobName}
              onChange={(event) =>
                update({
                  ...draft,
                  jobs: draft.jobs.map((item, i) =>
                    i === index
                      ? { ...item, jobName: event.currentTarget.value }
                      : item,
                  ),
                })
              }
            />
            <SettingsButton
              className="remove-btn"
              aria-label={t("cherryPickRemove")}
              onClick={() => update(withoutJob(draft, index))}
            >
              ×
            </SettingsButton>
          </div>
        ))}
      </div>
      <SettingsButton
        className="add-btn"
        id={profile ? "profileAddCustomJob" : "addCustomJob"}
        onClick={() =>
          update(
            withRowKeys(
              { ...draft, jobs: [...draft.jobs, { label: "", jobName: "" }] },
              "jobs",
              [...keys, crypto.randomUUID()],
            ),
          )
        }
      >
        {t("addJobButton")}
      </SettingsButton>
    </>
  );
}

export function MrActionsEditor({ draft, update, t, profile }: EditorProps) {
  return (
    <>
      <div id={profile ? "profileMrActionsList" : "mrActionsList"}>
        {draft.actions.map((action) => {
          const change = (values: Partial<typeof action>) =>
            update({
              ...draft,
              actions: draft.actions.map((item) =>
                item.id === action.id ? { ...item, ...values } : item,
              ),
            });
          return (
            <div className="mr-action" data-id={action.id} key={action.id}>
              <div className="mr-action-heading">
                <input
                  type="text"
                  data-field="label"
                  aria-label={t("mrActionLabel")}
                  placeholder={t("mrActionLabel")}
                  value={action.label}
                  onChange={(event) =>
                    change({ label: event.currentTarget.value })
                  }
                />
                <SettingsButton
                  className="remove-btn"
                  aria-label={t("mrActionDelete")}
                  onClick={() =>
                    update({
                      ...draft,
                      actions: draft.actions.filter(
                        (item) => item.id !== action.id,
                      ),
                      order: draft.order.filter(
                        (key) => key !== `mr_action_${action.id}`,
                      ),
                    })
                  }
                >
                  ×
                </SettingsButton>
              </div>
              <select
                data-field="type"
                aria-label={t("mrActionType")}
                value={action.type}
                onChange={(event) =>
                  change({ type: event.currentTarget.value })
                }
              >
                {MR_ACTION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t("mrAction_" + type)}
                  </option>
                ))}
              </select>
              <div
                className="mr-action-labels"
                hidden={!/^(remove|add|set)_labels$/.test(action.type)}
              >
                <textarea
                  rows={2}
                  data-field="labels"
                  aria-label={t("mrActionLabels")}
                  placeholder={t("mrActionLabels")}
                  value={action.labels || ""}
                  onChange={(event) =>
                    change({ labels: event.currentTarget.value })
                  }
                />
                <div className="hint">{t("mrActionLabelsHint")}</div>
              </div>
            </div>
          );
        })}
      </div>
      <SettingsButton
        className="add-btn"
        id={profile ? "profileAddMrAction" : "addMrAction"}
        onClick={() =>
          update({
            ...draft,
            actions: [
              ...draft.actions,
              {
                id: crypto.randomUUID(),
                label: "",
                type: "remove_labels",
                labels: "",
              },
            ],
          })
        }
      >
        + {t("mrActionAdd")}
      </SettingsButton>
    </>
  );
}

export function QuickCommentsEditor({ draft, update, t }: EditorProps) {
  const keys = rowKeys(draft, "comments");
  return (
    <>
      <div id="quickCommentsList">
        {draft.comments.map((comment, index) => (
          <div className="quick-comment-row" key={keys[index]}>
            <div className="jqa-row">
              <input
                type="text"
                data-field="label"
                aria-label={t("mrActionLabel")}
                placeholder="LGTM"
                value={comment.label}
                style={{ flex: 1 }}
                onChange={(event) =>
                  update({
                    ...draft,
                    comments: draft.comments.map((item, i) =>
                      i === index
                        ? { ...item, label: event.currentTarget.value }
                        : item,
                    ),
                  })
                }
              />
              <SettingsButton
                className="remove-btn"
                aria-label={t("cherryPickRemove")}
                onClick={() =>
                  update(
                    withRowKeys(
                      {
                        ...draft,
                        comments: draft.comments.filter(
                          (_item, i) => i !== index,
                        ),
                      },
                      "comments",
                      keys.filter((_key, i) => i !== index),
                    ),
                  )
                }
              >
                ×
              </SettingsButton>
            </div>
            <div className="jqa-row">
              <input
                type="text"
                data-field="text"
                aria-label={t("aiReviewImportEditorLabel")}
                placeholder={t("jiraSidebarCommentPlaceholder")}
                value={comment.text}
                style={{ width: "100%" }}
                onChange={(event) =>
                  update({
                    ...draft,
                    comments: draft.comments.map((item, i) =>
                      i === index
                        ? { ...item, text: event.currentTarget.value }
                        : item,
                    ),
                  })
                }
              />
            </div>
          </div>
        ))}
      </div>
      <SettingsButton
        className="add-btn"
        id="addQuickComment"
        onClick={() =>
          update(
            withRowKeys(
              {
                ...draft,
                comments: [...draft.comments, { label: "", text: "" }],
              },
              "comments",
              [...keys, crypto.randomUUID()],
            ),
          )
        }
      >
        + {t("quickCommentsAdd")}
      </SettingsButton>
    </>
  );
}

export function CherryPickEditor({ draft, update, t }: EditorProps) {
  const keys = rowKeys(draft, "branches");
  return (
    <>
      <div id="cherryPickBranchesList">
        {draft.branches.map((branch, index) => (
          <div className="cherry-pick-branch-row" key={keys[index]}>
            <div className="jqa-row field">
              <input
                type="text"
                data-field="branch"
                aria-label={t("cherryPickBranchPlaceholder")}
                placeholder={t("cherryPickBranchPlaceholder")}
                value={branch}
                style={{ flex: 1 }}
                onChange={(event) =>
                  update({
                    ...draft,
                    branches: draft.branches.map((item, i) =>
                      i === index ? event.currentTarget.value : item,
                    ),
                  })
                }
              />
              <SettingsButton
                className="remove-btn"
                aria-label={t("cherryPickRemove")}
                onClick={() =>
                  update(
                    withRowKeys(
                      {
                        ...draft,
                        branches: draft.branches.filter(
                          (_item, i) => i !== index,
                        ),
                      },
                      "branches",
                      keys.filter((_key, i) => i !== index),
                    ),
                  )
                }
              >
                ×
              </SettingsButton>
            </div>
          </div>
        ))}
      </div>
      <SettingsButton
        className="add-btn"
        id="addCherryPickBranch"
        onClick={() =>
          update(
            withRowKeys(
              { ...draft, branches: [...draft.branches, ""] },
              "branches",
              [...keys, crypto.randomUUID()],
            ),
          )
        }
      >
        + {t("cherryPickBranchAdd")}
      </SettingsButton>
    </>
  );
}

function JiraFieldEditor({
  field,
  update,
  remove,
  t,
}: {
  field: JiraFieldDraft;
  update: (field: JiraFieldDraft) => void;
  remove: () => void;
  t: EditorProps["t"];
}) {
  const multi = isJiraListField(field.field);
  return (
    <div className="jqa-change">
      <div className="jqa-row">
        <select
          data-part="field"
          aria-label={t("jiraQuickActionField")}
          value={field.field}
          onChange={(event) =>
            update({
              ...field,
              field: event.currentTarget.value,
              value: "",
              operation: "add",
            })
          }
        >
          {JIRA_ACTION_FIELDS.map(([value, label]) => (
            <option key={value} value={value}>
              {t(label)}
            </option>
          ))}
        </select>
        <select
          data-part="operation"
          aria-label={t("jiraQuickActionOperation")}
          hidden={!multi}
          value={field.operation}
          onChange={(event) =>
            update({ ...field, operation: event.currentTarget.value })
          }
        >
          <option value="add">{t("jiraQuickActionAddValues")}</option>
          <option value="remove">{t("jiraQuickActionRemoveValues")}</option>
          <option value="set">{t("jiraQuickActionSetValues")}</option>
        </select>
        <SettingsButton
          className="remove-btn"
          aria-label={t("jiraQuickActionRemove")}
          onClick={remove}
        >
          ×
        </SettingsButton>
      </div>
      <input
        data-part="custom"
        aria-label={t("jiraQuickActionCustom")}
        placeholder="customfield_12345"
        hidden={field.field !== "custom"}
        value={field.custom}
        onChange={(event) =>
          update({ ...field, custom: event.currentTarget.value })
        }
      />
      <input
        data-part="value"
        aria-label={t("jiraQuickActionValue")}
        placeholder={
          field.field === "duedate"
            ? "YYYY-MM-DD"
            : field.field === "assignee"
              ? "username"
              : ""
        }
        value={field.value}
        onChange={(event) =>
          update({ ...field, value: event.currentTarget.value })
        }
      />
      <div className="hint jqa-value-hint">
        {t(
          field.field === "custom"
            ? "jiraQuickActionCustomHint"
            : multi
              ? "jiraQuickActionListHint"
              : field.field === "status"
                ? "jiraQuickActionStatusHint"
                : "jiraQuickActionValueHint",
        )}
      </div>
    </div>
  );
}

export function JiraActionsEditor({ draft, update, t }: EditorProps) {
  return (
    <>
      <div id="jiraQuickActionsList">
        {draft.jiraActions.map((action) => {
          const change = (values: Partial<typeof action>) =>
            update({
              ...draft,
              jiraActions: draft.jiraActions.map((item) =>
                item.id === action.id ? { ...item, ...values } : item,
              ),
            });
          return (
            <div className="jira-quick-action" key={action.id}>
              <div className="jqa-row">
                <input
                  type="text"
                  data-field="label"
                  aria-label={t("jiraQuickActionLabel")}
                  placeholder={t("jiraQuickActionLabel")}
                  value={action.label}
                  onChange={(event) =>
                    change({ label: event.currentTarget.value })
                  }
                />
                <SettingsButton
                  className="remove-btn"
                  aria-label={t("jiraQuickActionRemove")}
                  onClick={() =>
                    update({
                      ...draft,
                      jiraActions: draft.jiraActions.filter(
                        (item) => item.id !== action.id,
                      ),
                    })
                  }
                >
                  ×
                </SettingsButton>
              </div>
              <div className="jqa-changes">
                {action.fields.map((field) => (
                  <JiraFieldEditor
                    key={field.id}
                    field={field}
                    t={t}
                    update={(next) =>
                      change({
                        fields: action.fields.map((item) =>
                          item.id === field.id ? next : item,
                        ),
                      })
                    }
                    remove={() =>
                      change({
                        fields: action.fields.filter(
                          (item) => item.id !== field.id,
                        ),
                      })
                    }
                  />
                ))}
              </div>
              <SettingsButton
                className="add-btn jqa-add-field"
                onClick={() =>
                  change({
                    fields: [
                      ...action.fields,
                      createJiraFieldDraft({
                        field: "labels",
                        operation: "add",
                        value: [],
                      }),
                    ],
                  })
                }
              >
                + {t("jiraQuickActionAddField")}
              </SettingsButton>
            </div>
          );
        })}
      </div>
      <SettingsButton
        className="add-btn"
        id="addJiraQuickAction"
        onClick={() =>
          update({
            ...draft,
            jiraActions: [...draft.jiraActions, createJiraActionDraft()],
          })
        }
      >
        + {t("jiraQuickActionsAdd")}
      </SettingsButton>
    </>
  );
}
