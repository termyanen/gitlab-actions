/** Shared section order and labels for full settings and the compact popup. */
export const categories = [
  ["actions", "settingsActions"],
  ["ci", "settingsCi"],
  ["jira", "jiraIntegration"],
  ["ai", "aiReviewSettingsTitle"],
  ["appearance", "settingsAppearance"],
  ["general", "general"],
  ["data", "settingsData"],
] as const;
export type Category = (typeof categories)[number][0];
