import { isRecord } from "../../../shared/lib/validation";
import {
  createDraft,
  markProjectChanges,
  inheritProjectSetting,
  projectDraftValue,
} from "./draft";
import type { SettingsDraft } from "./draft";
import type { Settings } from "../../../features/manage-settings";

const same = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

/** Apply only edited properties; arrays remain one user-managed value. */
export function mergeSettingsEdits(
  before: Record<string, unknown>,
  edited: Record<string, unknown>,
  latest: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...latest };
  for (const key of new Set([...Object.keys(before), ...Object.keys(edited)])) {
    if (same(before[key], edited[key])) continue;
    if (!Object.hasOwn(edited, key)) {
      const oldValue = before[key];
      const savedValue = latest[key];
      // Clearing the last local override removes its container. It must not
      // delete a different override added by another settings window meanwhile.
      if (
        (key === "overrides" || key === "buttons") &&
        isRecord(oldValue) &&
        isRecord(savedValue)
      ) {
        const remaining = mergeSettingsEdits(oldValue, {}, savedValue);
        if (Object.keys(remaining).length) result[key] = remaining;
        else delete result[key];
      } else delete result[key];
    } else {
      const oldValue = before[key];
      const newValue = edited[key];
      const savedValue = latest[key];
      result[key] =
        (oldValue === undefined || isRecord(oldValue)) &&
        isRecord(newValue) &&
        isRecord(savedValue)
          ? mergeSettingsEdits(oldValue || {}, newValue, savedValue)
          : newValue;
    }
  }
  return result;
}

/** Refresh inherited/remote values without replacing unfinished input or row focus. */
export function refreshDraft(
  current: SettingsDraft,
  previous: Settings,
  latest: Settings,
  scope: string,
  baseline?: SettingsDraft,
): SettingsDraft {
  const persistedBefore = createDraft(previous, scope);
  const before = baseline || persistedBefore;
  const next = createDraft(latest, scope);
  const fields = { ...next.fields };
  for (const key of Object.keys(current.fields))
    if (
      !same(current.fields[key], before.fields[key]) ||
      same(persistedBefore.fields[key], next.fields[key])
    )
      fields[key] = current.fields[key] ?? "";
  const result: SettingsDraft = { ...next, fields };
  for (const key of [
    "jobs",
    "actions",
    "comments",
    "branches",
    "order",
  ] as const) {
    // Keep each collection's element type while merging through the whole draft.
    if (
      !same(current[key], before[key]) ||
      same(persistedBefore[key], next[key])
    )
      Object.assign(result, { [key]: current[key] });
  }
  if (
    !same(
      projectDraftValue(current, "jiraQuickActions"),
      projectDraftValue(before, "jiraQuickActions"),
    ) ||
    same(
      projectDraftValue(persistedBefore, "jiraQuickActions"),
      projectDraftValue(next, "jiraQuickActions"),
    )
  )
    result.jiraActions = current.jiraActions;
  if (current.overrides) {
    const removed = new Set(
      (before.overrides || []).filter(
        (key) => !current.overrides?.includes(key),
      ),
    );
    result.overrides = [
      ...new Set([
        ...(next.overrides || []),
        ...current.overrides.filter((key) => !before.overrides?.includes(key)),
      ]),
    ].filter((key) => !removed.has(key));
  }
  result.rowKeys = {
    jobs: same(current.jobs, result.jobs)
      ? current.rowKeys?.jobs || []
      : next.rowKeys?.jobs || [],
    comments: same(current.comments, result.comments)
      ? current.rowKeys?.comments || []
      : next.rowKeys?.comments || [],
    branches: same(current.branches, result.branches)
      ? current.rowKeys?.branches || []
      : next.rowKeys?.branches || [],
  };
  if (current.resetLegacy) result.resetLegacy = current.resetLegacy;
  // Existing edits, including edits made to previously inherited values, remain owned.
  let marked = markProjectChanges(
    { ...next, ...(result.overrides ? { overrides: result.overrides } : {}) },
    result,
  );
  if (current.resetLegacy)
    marked.legacyKeys =
      marked.legacyKeys?.filter((key) => !current.resetLegacy?.includes(key)) ||
      [];
  for (const key of current.resetLegacy || [])
    marked = inheritProjectSetting(marked, key);
  for (const key of before.overrides || [])
    if (!current.overrides?.includes(key))
      marked = inheritProjectSetting(marked, key);
  return marked;
}
