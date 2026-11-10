import { findSettingsProfileKey } from "../../../shared/api/project-settings";
import {
  DEFAULTS,
  SETTINGS_FILE_MAX_BYTES,
  createSettingsValidation,
} from "../../../features/manage-settings";
import type { Settings } from "../../../features/manage-settings";
import { readDisplayPreferences } from "../../../entities/settings";
import { isLanguage } from "../../../shared/i18n";
import {
  INSTRUCTION_BLOCKS,
  INSTRUCTION_PREFIX,
  normalizeInstruction,
  normalizeResponseLanguage,
} from "../../../entities/review";
import {
  isProjectPath,
  projectPathFromUrl,
} from "../../../shared/lib/project-url";
import { SETTINGS_PAGE } from "../../../shared/config/extension";
import { reportRuntimeError } from "../../../shared/api/runtime";
import { createDraft, serializeDraft, markProjectChanges } from "./draft";
import type { SettingsDraft, Translate } from "./draft";
import { mergeSettingsEdits, refreshDraft } from "./persistence";
import { effectiveScope, readCategory } from "./navigation";
import type { Category } from "../../../shared/config/settings-navigation";

const AUTOSAVE_DEBOUNCE_MS = 500;
const SUCCESS_STATUS_LIFETIME_MS = 10000;
const DOWNLOAD_URL_LIFETIME_MS = 10000;
const SYNC_TOTAL_BYTES = 102400;
const SYNC_MAX_ITEMS = 512;
export interface SettingsState {
  data: Settings | null;
  draft: SettingsDraft | null;
  scope: string;
  category: Category;
  search: string;
  currentProject: string | null;
  status: {
    key: string;
    kind: "ready" | "unsaved" | "saved" | "failed";
    message?: string;
  };
  busy: boolean;
  loaded: boolean;
  dirty: boolean;
  preview: { settings: Settings; name: string } | null;
}
export function readSettingsStorage(
  keys: string[] | null,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) =>
    chrome.storage.sync.get(keys, (data: Record<string, unknown>) => {
      if (chrome.runtime.lastError) reject(new Error("settingsLoadFailed"));
      else resolve(data);
    }),
  );
}
function writeSettingsStorage(data: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) =>
    chrome.storage.sync.set(data, () => {
      if (chrome.runtime.lastError) reject(new Error("settingsSaveFailed"));
      else resolve();
    }),
  );
}
export class SettingsController {
  private state: SettingsState = {
    data: null,
    draft: null,
    scope: "default",
    category: readCategory(
      new URLSearchParams(location.hash.slice(1)).get("section"),
    ),
    search: "",
    currentProject: null,
    status: { key: "settingsAutosaveHint", kind: "ready" },
    busy: false,
    loaded: false,
    dirty: false,
    preview: null,
  };
  private listeners = new Set<() => void>();
  private draftBaseline: SettingsDraft | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private revision = 0;
  private pending: Promise<boolean> | null = null;
  private pendingRevision = -1;
  private pendingValues: Record<string, unknown> | undefined;
  private writeTail: Promise<unknown> = Promise.resolve();
  private importRevision = 0;
  private downloads = new Map<string, ReturnType<typeof setTimeout>>();
  private statusTimer: ReturnType<typeof setTimeout> | undefined;
  constructor(private t: Translate) {}
  setTranslator(t: Translate) {
    this.t = t;
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private patch(next: Partial<SettingsState>) {
    if (this.disposed) return;
    if (next.status) {
      clearTimeout(this.statusTimer);
      this.statusTimer = undefined;
      const status = next.status;
      if (status.kind === "saved")
        this.statusTimer = setTimeout(() => {
          if (this.disposed || this.state.status !== status) return;
          this.statusTimer = undefined;
          this.patch({ status: { key: "", kind: "ready" } });
        }, SUCCESS_STATUS_LIFETIME_MS);
    }
    this.state = { ...this.state, ...next };
    this.listeners.forEach((fn) => fn());
  }
  private fail(key: string, error?: unknown) {
    this.patch({
      status: {
        key,
        kind: "failed",
        ...(error instanceof Error ? { message: error.message } : {}),
      },
    });
  }
  private loadDraft(data: Settings, scope = "default") {
    const draft = createDraft(data, scope);
    this.draftBaseline = draft;
    return draft;
  }
  private enqueue<T>(write: () => Promise<T>): Promise<T> {
    // Extension pages share an origin. Serialize read/merge/write transactions
    // across the popup and settings tabs, not just within this controller.
    const operation = this.writeTail.then(() =>
      navigator.locks.request("gitlab-mr-actions-settings", () => {
        if (this.disposed) throw new Error("settingsSaveFailed");
        return write();
      }),
    );
    this.writeTail = operation.catch(() => {});
    return operation;
  }
  private saveEdits(
    before: Settings,
    values: Record<string, unknown>,
    queued?: Record<string, unknown>,
  ) {
    return this.enqueue(async () => {
      const stored = await readSettingsStorage(Object.keys(DEFAULTS));
      let merged = mergeSettingsEdits(
        before,
        { ...before, ...values },
        {
          ...DEFAULTS,
          ...stored,
        },
      );
      if (queued)
        merged = mergeSettingsEdits(
          { ...before, ...queued },
          { ...before, ...values },
          merged,
        );
      const delta = Object.fromEntries(
        Object.entries(merged).filter(
          ([key, value]) =>
            Object.hasOwn(values, key) &&
            JSON.stringify(value) !==
              JSON.stringify(stored[key] ?? DEFAULTS[key]),
        ),
      );
      if (Object.hasOwn(delta, "projectProfiles")) {
        const profiles = createSettingsValidation(this.t).parseSettingsFile(
          JSON.stringify({
            format: "gitlab-mr-actions-settings",
            formatVersion: 1,
            settings: { projectProfiles: delta.projectProfiles },
          }),
        );
        // A stale editor must not resurrect a profile removed by another window/import.
        for (const key of Object.keys(before.projectProfiles))
          if (
            Object.hasOwn(profiles.projectProfiles, key) &&
            !Object.hasOwn(stored.projectProfiles || {}, key)
          )
            throw new Error("settingsSaveFailed");
      }
      if (Object.keys(delta).length) await writeSettingsStorage(delta);
      return delta;
    });
  }
  async start() {
    this.patch({ busy: true });
    try {
      let project = new URLSearchParams(location.search).get("project");
      if (!isProjectPath(project)) project = null;
      const tabProject = await new Promise<string | undefined>((resolve) =>
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const failed = !!chrome.runtime.lastError;
          resolve(failed ? undefined : projectPathFromUrl(tabs[0]?.url));
        }),
      );
      const raw = await readSettingsStorage(Object.keys(DEFAULTS));
      // Preserve the former settings renderer's recovery for old/corrupt saved
      // instruction blocks. Import validation deliberately remains strict.
      for (const block of INSTRUCTION_BLOCKS) {
        const key = INSTRUCTION_PREFIX + block.id;
        try {
          raw[key] = normalizeInstruction(block, raw[key]);
        } catch {
          raw[key] = { enabled: true, text: block.text };
        }
      }
      for (const key of [
        "versionFile",
        "versionPath",
        "versionStrategy",
        "versionCommitTemplate",
        "reviewersJob",
        "commits_jira_field",
      ]) {
        if (raw[key] === "") raw[key] = DEFAULTS[key];
      }
      raw.ai_review_response_language = normalizeResponseLanguage(
        raw.ai_review_response_language,
      );
      if (!isLanguage(raw.language)) raw.language = "auto";
      Object.assign(raw, readDisplayPreferences(raw));
      const settings = createSettingsValidation(this.t).parseSettingsFile(
        JSON.stringify({
          format: "gitlab-mr-actions-settings",
          formatVersion: 1,
          settings: { ...DEFAULTS, ...raw },
        }),
      );
      project = project || tabProject || null;
      const scope =
        findSettingsProfileKey(settings.projectProfiles, project) ?? "default";
      this.patch({
        data: settings,
        draft: this.loadDraft(
          settings,
          effectiveScope(scope, this.state.category, ""),
        ),
        scope,
        currentProject: project,
        loaded: true,
        busy: false,
      });
      if (!this.disposed) {
        chrome.storage.onChanged.addListener(this.storageChanged);
        window.addEventListener("beforeunload", this.beforeUnload);
      }
    } catch {
      this.patch({ busy: false });
      this.fail("settingsLoadFailed");
    }
  }
  private beforeUnload = (event: BeforeUnloadEvent) => {
    if (this.state.dirty || this.pending) {
      event.preventDefault();
      event.returnValue = this.t("unsavedChanges");
    }
  };
  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    clearTimeout(this.statusTimer);
    for (const [url, timer] of this.downloads) {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
    }
    this.downloads.clear();
    this.listeners.clear();
    chrome.storage.onChanged.removeListener(this.storageChanged);
    window.removeEventListener("beforeunload", this.beforeUnload);
  }
  updateDraft = (draft: SettingsDraft) => {
    if (this.state.busy || !this.state.draft) return;
    draft = markProjectChanges(this.state.draft, draft);
    const languageChanged =
      draft.fields.language !== this.state.draft.fields.language;
    this.revision++;
    this.patch({
      draft,
      dirty: true,
      status: { key: "unsavedChanges", kind: "unsaved" },
    });
    clearTimeout(this.timer);
    // A locale selection is an explicit action, not text still being typed.
    // Preserve immediate language switching while saving the complete draft first.
    if (languageChanged) {
      this.timer = undefined;
      this.save().catch(() => this.fail("settingsSaveFailed"));
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.save().catch(() => this.fail("settingsSaveFailed"));
    }, AUTOSAVE_DEBOUNCE_MS);
  };
  async save(): Promise<boolean> {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.state.data || !this.state.draft) return false;
    if (this.pending && this.pendingRevision === this.revision)
      return this.pending;
    const revision = this.revision;
    const before = this.state.data;
    const submitted = this.state.draft;
    const baseline = this.draftBaseline;
    const scope = effectiveScope(
      this.state.scope,
      this.state.category,
      this.state.search,
    );
    if (scope !== "default" && !Object.hasOwn(before.projectProfiles, scope)) {
      this.fail("settingsSaveFailed");
      return false;
    }
    let values: Record<string, unknown>;
    try {
      values = serializeDraft(
        this.state.draft,
        this.state.data,
        effectiveScope(
          this.state.scope,
          this.state.category,
          this.state.search,
        ),
        this.t,
      );
    } catch (error) {
      this.fail("settingsSaveFailed", error);
      return false;
    }
    const queued = this.pendingValues;
    if (scope === "default") {
      const baseline = serializeDraft(
        createDraft(before),
        before,
        "default",
        this.t,
      );
      values = Object.fromEntries(
        Object.entries(values).filter(
          ([key, value]) =>
            JSON.stringify(value) !== JSON.stringify(baseline[key]) ||
            (queued && Object.hasOwn(queued, key)),
        ),
      );
    }
    this.pendingValues = values;
    this.patch({ status: { key: "settingsSaving", kind: "unsaved" } });
    this.pendingRevision = revision;
    const operation = this.saveEdits(before, values, queued)
      .then((delta) => {
        if (this.disposed) return false;
        const data = this.state.data;
        if (!data) return false;
        const next = { ...data, ...delta };
        const acknowledged = {
          ...refreshDraft(submitted, before, next, scope, baseline),
          resetLegacy: [],
        };
        this.draftBaseline = acknowledged;
        this.patch({
          data: next,
          ...(this.state.draft
            ? {
                draft:
                  revision === this.revision
                    ? acknowledged
                    : refreshDraft(
                        this.state.draft,
                        before,
                        next,
                        scope,
                        submitted,
                      ),
              }
            : {}),
        });
        if (revision === this.revision) {
          this.patch({
            dirty: false,
            ...(this.state.draft?.resetLegacy
              ? { draft: { ...this.state.draft, resetLegacy: [] } }
              : {}),
            status: { key: "saved", kind: "saved" },
          });
        }
        return true;
      })
      .catch(() => {
        if (revision === this.revision) this.fail("settingsSaveFailed");
        return false;
      })
      .finally(() => {
        if (this.pending === operation) {
          this.pending = null;
          this.pendingValues = undefined;
        }
      });
    this.pending = operation;
    return operation;
  }
  async navigate(
    next: Partial<Pick<SettingsState, "scope" | "category" | "search">>,
  ): Promise<boolean> {
    if (this.state.busy || !this.state.data) return false;
    const target = { ...this.state, ...next };
    const oldScope = effectiveScope(
      this.state.scope,
      this.state.category,
      this.state.search,
    );
    const newScope = effectiveScope(
      target.scope,
      target.category,
      target.search,
    );
    if (newScope !== oldScope && (this.state.dirty || this.pending)) {
      this.patch({ busy: true });
      const saved = await this.save();
      this.patch({ busy: false });
      if (!saved) return false;
    }
    const data = this.state.data;
    if (!data || this.disposed) return false;
    this.patch({
      ...next,
      ...(oldScope !== newScope
        ? { draft: this.loadDraft(data, newScope) }
        : {}),
    });
    if (next.category)
      history.replaceState(
        null,
        "",
        "#" + new URLSearchParams({ section: next.category }),
      );
    return true;
  }
  async addProfile(): Promise<void> {
    const project = this.state.currentProject;
    if (!project || !this.state.data || this.state.busy) return;
    this.patch({ busy: true });
    if (!(await this.save())) {
      this.patch({ busy: false });
      return;
    }
    try {
      const data = this.state.data;
      if (!data) return;
      const profiles = {
        ...data.projectProfiles,
        [project]: data.projectProfiles[project] || {},
      };
      const delta = await this.saveEdits(data, { projectProfiles: profiles });
      const next = { ...data, ...this.state.data, ...delta };
      this.patch({
        data: next,
        scope: project,
        draft: this.loadDraft(
          next,
          effectiveScope(project, this.state.category, this.state.search),
        ),
        status: { key: "saved", kind: "saved" },
      });
    } catch {
      this.fail("settingsSaveFailed");
    } finally {
      this.patch({ busy: false });
    }
  }
  async removeProfile(): Promise<void> {
    if (this.state.scope === "default" || this.state.busy || !this.state.data)
      return;
    this.patch({ busy: true });
    if (!(await this.save())) {
      this.patch({ busy: false });
      return;
    }
    try {
      const data = this.state.data;
      if (!data) return;
      const profiles = { ...data.projectProfiles };
      delete profiles[this.state.scope];
      const delta = await this.saveEdits(data, { projectProfiles: profiles });
      const next = { ...data, ...this.state.data, ...delta };
      this.patch({
        data: next,
        scope: "default",
        draft: this.loadDraft(next),
        status: { key: "saved", kind: "saved" },
      });
    } catch {
      this.fail("settingsSaveFailed");
    } finally {
      this.patch({ busy: false });
    }
  }
  async openSettings(): Promise<void> {
    if (this.state.busy) return;
    this.patch({ busy: true });
    if (await this.save())
      chrome.tabs.create(
        { url: chrome.runtime.getURL(SETTINGS_PAGE) },
        reportRuntimeError,
      );
    this.patch({ busy: false });
  }
  async exportSettings(): Promise<void> {
    if (this.state.busy) return;
    this.patch({ busy: true });
    try {
      if (!(await this.save())) return;
      const data = await readSettingsStorage(Object.keys(DEFAULTS));
      if (this.disposed) return;
      const file = {
        format: "gitlab-mr-actions-settings",
        formatVersion: 1,
        extensionVersion: chrome.runtime.getManifest().version,
        settings: createSettingsValidation(this.t).settingsSnapshot(data),
      };
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "gitlab-mr-actions-settings.json";
      this.downloads.set(
        url,
        setTimeout(() => {
          URL.revokeObjectURL(url);
          this.downloads.delete(url);
        }, DOWNLOAD_URL_LIFETIME_MS),
      );
      link.click();
    } catch {
      this.fail("settingsExportFailed");
    } finally {
      this.patch({ busy: false });
    }
  }
  async readImport(file: File): Promise<void> {
    const revision = ++this.importRevision;
    this.patch({ preview: null });
    if (file.size > SETTINGS_FILE_MAX_BYTES) {
      this.fail("settingsFileTooLarge");
      return;
    }
    try {
      const text = await file.text();
      if (revision !== this.importRevision || this.disposed) return;
      const settings = createSettingsValidation(this.t).parseSettingsFile(text);
      this.patch({ preview: { settings, name: file.name } });
    } catch (error) {
      if (revision === this.importRevision && !this.disposed)
        this.fail("settingsFileInvalid", error);
    }
  }
  cancelImport() {
    this.importRevision++;
    this.patch({ preview: null });
  }
  applyImport() {
    if (this.state.busy || !this.state.preview) return;
    const { settings } = this.state.preview;
    this.patch({ busy: true });
    const apply = () => {
      this.writeImport(settings).catch((error: unknown) => {
        this.fail(
          error instanceof Error &&
            error.message === this.t("settingsFileTooLarge")
            ? "settingsFileTooLarge"
            : "settingsImportFailed",
        );
        this.patch({ busy: false });
      });
    };
    const jiraOrigins = new Set<string>();
    if (settings.jira_url)
      jiraOrigins.add(new URL(settings.jira_url).origin + "/*");
    for (const profile of Object.values(settings.projectProfiles)) {
      const url = profile.overrides?.jira_url;
      if (typeof url === "string" && url)
        jiraOrigins.add(new URL(url).origin + "/*");
    }
    if (jiraOrigins.size) {
      chrome.permissions.request({ origins: [...jiraOrigins] }, (granted) => {
        const failed = !!chrome.runtime.lastError;
        if (this.disposed) return;
        if (failed || !granted) {
          this.fail("settingsImportPermissionDenied");
          this.patch({ busy: false });
        } else apply();
      });
    } else apply();
  }
  private async writeImport(settings: Settings) {
    clearTimeout(this.timer);
    this.timer = undefined;
    await this.enqueue(async () => {
      const stored = await readSettingsStorage(null);
      if (this.disposed) throw new Error("settingsImportFailed");
      const combined = { ...stored, ...settings };
      const bytes = Object.entries(combined).reduce(
        (total, [key, value]) =>
          total + new TextEncoder().encode(key + JSON.stringify(value)).length,
        0,
      );
      if (
        bytes > SYNC_TOTAL_BYTES ||
        Object.keys(combined).length > SYNC_MAX_ITEMS
      )
        throw new Error(this.t("settingsFileTooLarge"));
      await writeSettingsStorage(settings);
    });
    this.revision++;
    this.importRevision++;
    this.patch({
      data: settings,
      draft: this.loadDraft(settings),
      scope: "default",
      dirty: false,
      preview: null,
      busy: false,
      status: { key: "settingsImported", kind: "saved" },
    });
  }
  private storageChanged = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => {
    if (area !== "sync" || !this.state.data || !this.state.draft) return;
    const previous = this.state.data;
    const changesToSettings = Object.fromEntries(
      Object.entries(changes)
        .filter(([key]) => Object.hasOwn(DEFAULTS, key))
        .map(([key, change]) => [key, change.newValue ?? DEFAULTS[key]]),
    );
    if (!Object.keys(changesToSettings).length) return;
    try {
      const data = createSettingsValidation(this.t).parseSettingsFile(
        JSON.stringify({
          format: "gitlab-mr-actions-settings",
          formatVersion: 1,
          settings: { ...previous, ...changesToSettings },
        }),
      );
      const removed =
        this.state.scope !== "default" &&
        !Object.hasOwn(data.projectProfiles, this.state.scope);
      if (removed && (this.state.dirty || this.pending)) {
        // Keep unfinished input visible; saveEdits rejects a deleted profile.
        this.patch({
          data,
          status: { key: "settingsSaveFailed", kind: "failed" },
        });
        return;
      }
      const scope = removed ? "default" : this.state.scope;
      const effective = effectiveScope(
        scope,
        this.state.category,
        this.state.search,
      );
      const baseline = this.draftBaseline || createDraft(previous, effective);
      const draft = removed
        ? this.loadDraft(data, effective)
        : refreshDraft(this.state.draft, previous, data, effective, baseline);
      if (!removed)
        this.draftBaseline = refreshDraft(
          baseline,
          previous,
          data,
          effective,
          baseline,
        );
      this.patch({
        data,
        scope,
        draft,
      });
    } catch {
      this.fail("settingsLoadFailed");
    }
  };
}
