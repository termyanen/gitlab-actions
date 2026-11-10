import { isExtensionValid } from "../../../shared/api/runtime";
import { getRepositorySettings } from "./project-profile";
import { MR_DEFAULTS } from "./defaults";
import { readDisplayPreferences } from "./display-preferences";
import type { MrSettings } from "./types";
export function createMrSettingsReader(projectPath: () => string | null) {
  function getSettings(): Promise<MrSettings> {
    if (!isExtensionValid()) return Promise.resolve(MR_DEFAULTS);
    return new Promise<MrSettings>(function (resolve) {
      try {
        getRepositorySettings(
          MR_DEFAULTS,
          function (data: MrSettings) {
            if (!isExtensionValid()) {
              resolve(MR_DEFAULTS);
              return;
            }
            Object.assign(data, readDisplayPreferences(data));
            resolve(data);
          },
          projectPath(),
        );
      } catch {
        resolve(MR_DEFAULTS);
      }
    });
  }
  return getSettings;
}
