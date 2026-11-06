import {
  DISPLAY_NUMBER_LIMITS,
  FILE_PATTERN_MAX_LENGTH,
  readDisplayPreferences,
  validDisplayPreferences,
} from "../../../entities/settings";
import type { DisplayPreferences } from "../../../entities/settings";
import { byId, escHtml } from "./dom";

const NUMBER_FIELDS = [
  { key: "failed_jobs_limit", label: "failedJobsLimit" },
  { key: "failed_job_trace_lines", label: "failedJobTraceLines" },
  { key: "reviewer_notes_limit", label: "reviewerNotesLimit" },
] as const;
const TEXT_FIELDS = [
  { key: "mr_size_lines", label: "mrSizeLines", multiline: false },
  { key: "mr_size_files", label: "mrSizeFiles", multiline: false },
  {
    key: "sensitive_file_patterns",
    label: "sensitiveFilePatterns",
    multiline: true,
  },
  {
    key: "sensitive_file_exclusions",
    label: "sensitiveFileExclusions",
    multiline: true,
  },
] as const;

export function displayPreferencesSection(t: (key: string) => string) {
  const numbers = NUMBER_FIELDS.map(({ key, label }) => {
    const policy = DISPLAY_NUMBER_LIMITS[key];
    return `<div class="field"><label for="${key}">${escHtml(t(label))} (${policy.min}–${policy.max})</label><input id="${key}" type="number" min="${policy.min}" max="${policy.max}" step="1" required></div>`;
  }).join("");
  const text = TEXT_FIELDS.map(({ key, label, multiline }) => {
    const input = multiline
      ? `<textarea id="${key}" rows="3" maxlength="${FILE_PATTERN_MAX_LENGTH}"></textarea>`
      : `<input id="${key}" type="text" required>`;
    return `<div class="field"><label for="${key}">${escHtml(t(label))}</label>${input}</div>`;
  }).join("");
  return `<details class="ai-review-rules"><summary>${escHtml(t("displayPreferencesTitle"))}</summary><p class="hint">${escHtml(t("displayPreferencesHint"))}</p>${numbers}<p class="hint">${escHtml(t("sizeThresholdsHint"))}</p>${text}<div class="toggle"><input type="checkbox" id="sensitive_file_defaults"><label for="sensitive_file_defaults">${escHtml(t("sensitiveFileDefaults"))}</label></div><p class="hint">${escHtml(t("sensitivePatternsHint"))}</p></details>`;
}

export function populateDisplayPreferences(data: Record<string, unknown>) {
  const preferences = readDisplayPreferences(data);
  NUMBER_FIELDS.forEach(({ key }) => {
    byId<HTMLInputElement>(key).value = String(preferences[key]);
  });
  TEXT_FIELDS.forEach(({ key }) => {
    byId<HTMLInputElement | HTMLTextAreaElement>(key).value = preferences[key];
  });
  byId<HTMLInputElement>("sensitive_file_defaults").checked =
    preferences.sensitive_file_defaults;
}

export function readDisplayPreferencesForm(
  t: (key: string) => string,
): DisplayPreferences {
  const values: Record<string, unknown> = {};
  NUMBER_FIELDS.forEach(({ key }) => {
    values[key] = Number(byId<HTMLInputElement>(key).value);
  });
  TEXT_FIELDS.forEach(({ key }) => {
    values[key] = byId<HTMLInputElement | HTMLTextAreaElement>(
      key,
    ).value.trim();
  });
  values.sensitive_file_defaults = byId<HTMLInputElement>(
    "sensitive_file_defaults",
  ).checked;
  if (!validDisplayPreferences(values))
    throw new Error(t("displayPreferencesInvalid"));
  return readDisplayPreferences(values);
}
