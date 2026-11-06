// User policies shared by the form, imported settings and content scripts.
// Keep request/render bounds finite even when sync storage is edited externally.
export const DISPLAY_NUMBER_LIMITS = {
  failed_jobs_limit: { min: 1, max: 20, defaultValue: 5 },
  failed_job_trace_lines: { min: 10, max: 500, defaultValue: 50 },
  reviewer_notes_limit: { min: 1, max: 100, defaultValue: 10 },
};
export const FILE_PATTERN_MAX_LENGTH = 1500;
export const DISPLAY_DEFAULTS = {
  failed_jobs_limit: DISPLAY_NUMBER_LIMITS.failed_jobs_limit.defaultValue,
  failed_job_trace_lines:
    DISPLAY_NUMBER_LIMITS.failed_job_trace_lines.defaultValue,
  reviewer_notes_limit: DISPLAY_NUMBER_LIMITS.reviewer_notes_limit.defaultValue,
  mr_size_lines: "50, 200, 500",
  mr_size_files: "5, 15, 30",
  sensitive_file_defaults: true,
  sensitive_file_patterns: "",
  sensitive_file_exclusions: "",
};
export type DisplayPreferences = typeof DISPLAY_DEFAULTS;
type SizeThresholds = [number, number, number];

export function parseSizeThresholds(value: unknown): SizeThresholds | null {
  if (typeof value !== "string") return null;
  const parts = value.split(",").map((part) => part.trim());
  if (parts.length !== 3 || parts.some((part) => !/^\d+$/.test(part)))
    return null;
  const [small, medium, large] = parts.map(Number);
  if (
    ![small, medium, large].every(Number.isSafeInteger) ||
    small < 1 ||
    small >= medium ||
    medium >= large
  )
    return null;
  return [small, medium, large];
}

function validNumber(value: unknown, policy: { min: number; max: number }) {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= policy.min &&
    value <= policy.max
  );
}
function validPatterns(value: unknown) {
  return typeof value === "string" && value.length <= FILE_PATTERN_MAX_LENGTH;
}

export function validDisplayPreferences(data: Record<string, unknown>) {
  return (
    Object.entries(DISPLAY_NUMBER_LIMITS).every(([key, policy]) =>
      validNumber(data[key], policy),
    ) &&
    parseSizeThresholds(data.mr_size_lines) !== null &&
    parseSizeThresholds(data.mr_size_files) !== null &&
    typeof data.sensitive_file_defaults === "boolean" &&
    validPatterns(data.sensitive_file_patterns) &&
    validPatterns(data.sensitive_file_exclusions)
  );
}

export function readDisplayPreferences(
  data: Partial<Record<keyof DisplayPreferences, unknown>>,
): DisplayPreferences {
  function number(key: keyof typeof DISPLAY_NUMBER_LIMITS) {
    const value = data[key];
    return typeof value === "number" &&
      validNumber(value, DISPLAY_NUMBER_LIMITS[key])
      ? value
      : DISPLAY_DEFAULTS[key];
  }
  function thresholds(key: "mr_size_lines" | "mr_size_files") {
    const value = data[key];
    return typeof value === "string" && parseSizeThresholds(value)
      ? value
      : DISPLAY_DEFAULTS[key];
  }
  function patterns(
    key: "sensitive_file_patterns" | "sensitive_file_exclusions",
  ) {
    const value = data[key];
    return typeof value === "string" && validPatterns(value)
      ? value
      : DISPLAY_DEFAULTS[key];
  }
  return {
    failed_jobs_limit: number("failed_jobs_limit"),
    failed_job_trace_lines: number("failed_job_trace_lines"),
    reviewer_notes_limit: number("reviewer_notes_limit"),
    mr_size_lines: thresholds("mr_size_lines"),
    mr_size_files: thresholds("mr_size_files"),
    sensitive_file_defaults:
      typeof data.sensitive_file_defaults === "boolean"
        ? data.sensitive_file_defaults
        : DISPLAY_DEFAULTS.sensitive_file_defaults,
    sensitive_file_patterns: patterns("sensitive_file_patterns"),
    sensitive_file_exclusions: patterns("sensitive_file_exclusions"),
  };
}
