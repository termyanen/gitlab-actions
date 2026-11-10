import { useEffect, useRef, useState } from "react";
import { QUICK_SETTINGS_DEFAULTS } from "../../../entities/settings/content";
import { projectPathFromUrl } from "../../../shared/lib/project-url";

export const quickSettings = [
  {
    key: "sound_enabled",
    label: "soundNotifications",
    fallback: QUICK_SETTINGS_DEFAULTS.sound_enabled,
  },
  {
    key: "notifications_enabled",
    label: "desktopNotifications",
    fallback: QUICK_SETTINGS_DEFAULTS.notifications_enabled,
  },
] as const;
type QuickKey = (typeof quickSettings)[number]["key"];
interface PopupState {
  data: Record<string, unknown>;
  project: string | undefined;
  loading: boolean;
  failed: boolean;
  pending: ReadonlySet<QuickKey>;
  status: "" | "settingsSaving" | "settingsSaveFailed" | "saved";
}
const storageKeys = [
  "language",
  "projectProfiles",
  "jira_url",
  ...quickSettings.map((setting) => setting.key),
];

export function usePopup() {
  const [state, setState] = useState<PopupState>({
    data: {},
    project: undefined,
    loading: true,
    failed: false,
    pending: new Set(),
    status: "",
  });
  const active = useRef(false);
  const pending = useRef(new Set<QuickKey>());
  const failures = useRef(new Set<QuickKey>());
  const latest = useRef<Record<string, unknown>>({});
  const changeVersions = useRef<Record<string, number>>({});
  useEffect(() => {
    active.current = true;
    let mounted = true;
    const changesSinceRead: Record<string, unknown> = {};
    const changed = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== "sync" || !mounted) return;
      const updates: Record<string, unknown> = {};
      for (const key of storageKeys) {
        const change = changes[key];
        if (!change) continue;
        const value: unknown = change.newValue;
        latest.current[key] = value;
        changeVersions.current[key] = (changeVersions.current[key] ?? 0) + 1;
        changesSinceRead[key] = value;
        // A write's checked state stays stable until Chrome acknowledges it.
        if (
          !quickSettings.some(
            (setting) =>
              setting.key === key && pending.current.has(setting.key),
          )
        )
          updates[key] = value;
      }
      if (Object.keys(updates).length)
        setState((previous) => ({
          ...previous,
          data: { ...previous.data, ...updates },
        }));
    };
    chrome.storage.onChanged.addListener(changed);
    chrome.storage.sync.get(storageKeys, (saved) => {
      const failed = !!chrome.runtime.lastError;
      if (!mounted) return;
      if (failed) {
        setState((previous) => ({ ...previous, loading: false, failed: true }));
        return;
      }
      latest.current = { ...saved, ...changesSinceRead };
      setState((previous) => ({ ...previous, data: { ...latest.current } }));
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tabFailed = !!chrome.runtime.lastError;
        if (!mounted) return;
        const project = tabFailed
          ? undefined
          : projectPathFromUrl(tabs[0]?.url);
        setState((previous) => ({ ...previous, project, loading: false }));
      });
    });
    return () => {
      mounted = false;
      active.current = false;
      chrome.storage.onChanged.removeListener(changed);
    };
  }, []);

  function toggle(key: QuickKey, checked: boolean) {
    if (pending.current.has(key)) return;
    const previous = latest.current[key];
    const changeVersion = changeVersions.current[key] ?? 0;
    pending.current.add(key);
    failures.current.delete(key);
    setState((current) => ({
      ...current,
      data: { ...current.data, [key]: checked },
      pending: new Set(pending.current),
      status: "settingsSaving",
    }));
    chrome.storage.sync.set({ [key]: checked }, () => {
      const failed = !!chrome.runtime.lastError;
      if (!active.current) return;
      pending.current.delete(key);
      if (failed) failures.current.add(key);
      // Preserve a concurrent storage notification, including external changes.
      const stored = latest.current[key];
      const changed = (changeVersions.current[key] ?? 0) !== changeVersion;
      const value = changed
        ? typeof stored === "boolean"
          ? stored
          : QUICK_SETTINGS_DEFAULTS[key]
        : failed
          ? typeof previous === "boolean"
            ? previous
            : QUICK_SETTINGS_DEFAULTS[key]
          : checked;
      latest.current[key] = value;
      const status = failures.current.size
        ? "settingsSaveFailed"
        : pending.current.size
          ? "settingsSaving"
          : "saved";
      setState((current) => ({
        ...current,
        data: { ...current.data, [key]: value },
        pending: new Set(pending.current),
        status,
      }));
    });
  }
  return { ...state, toggle };
}
