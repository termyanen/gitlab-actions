import type { createSettingsValidation } from "../../../features/manage-settings";
import type { SettingsPageState } from "../model/types";
import type { createActionEditors } from "./action-editors";
import type { ButtonOrderEditor } from "./button-order";
export interface SettingsFormContext {
  saveDefaultTab: (
    onSaved?: (() => void) | null,
    onFailed?: (() => void) | null,
  ) => void;
  state: SettingsPageState;
  editors: ReturnType<typeof createActionEditors>;
  order: ButtonOrderEditor;
  t: (key: string, substitutions?: string[]) => string;
  scheduleAutoSave: () => void;
  loadLanguage: (lang: string, callback: () => void) => void;
  localizeHeader: () => void;
  renderTabs: () => void;
  renderActiveTab: () => void;
  showSaveFailed: (message?: string) => void;
  showSaved: (version?: number) => void;
  validateMrActions: ReturnType<
    typeof createSettingsValidation
  >["validateMrActions"];
}
