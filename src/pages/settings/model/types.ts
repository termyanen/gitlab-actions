import type { Settings } from "../../../features/manage-settings";
export interface ButtonItem {
  key: string;
  label: string;
  enabled: boolean;
  isCustom: boolean;
}

export interface SettingsPageState {
  data: Partial<Settings>;
  statusVersion: number;
  autoSaveTimer: ReturnType<typeof setTimeout> | null;
}
