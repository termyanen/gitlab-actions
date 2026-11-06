import type { Settings } from "../../../features/manage-settings";
import {
  DEFAULTS,
  SETTINGS_FILE_MAX_BYTES,
  createSettingsValidation,
} from "../../../features/manage-settings";
import { reportRuntimeError } from "../../../shared/api/runtime";
import {
  CHANGELOG_BASE_URL,
  SETTINGS_PAGE,
  STORE_REVIEWS_URL,
} from "../../../shared/config/extension";
import { readMessages } from "../../../shared/i18n";
import { reportError } from "../../../shared/lib/errors";
import { eventElement, requireElement } from "../../../shared/ui/dom";
import type { SettingsPageState } from "../model/types";
import { createActionEditors } from "./action-editors";
import { createButtonOrderEditor } from "./button-order";
import { createDefaultSettingsForm } from "./default-form";
import { buttonById, byId, escHtml, inputById } from "./dom";
import type { SettingsFormContext } from "./form-context";
import { createSettingsPersistence } from "./persistence";
import { createProfileSettingsForm } from "./profile-form";
const SAVE_STATUS_DURATION_MS = 1500;
const SAVE_STATUS_FADE_MS = 300;
const AUTOSAVE_DEBOUNCE_MS = 500;
const DOWNLOAD_URL_LIFETIME_MS = 10000;
const state: SettingsPageState = {
  data: {},
  statusVersion: 0,
  autoSaveTimer: null,
};
const editors = createActionEditors({
  t,
  scheduleAutoSave: () => scheduleAutoSave(),
  getButtonOrderFromUI: (id) => getButtonOrderFromUI(id),
  renderButtonOrder: (items, id) => renderButtonOrder(items, id),
  validateMrActions: (actions) => validateMrActions(actions),
});

const { buildOrderedList, renderButtonOrder, getButtonOrderFromUI } =
  createButtonOrderEditor(t, scheduleAutoSave);
const { validateMrActions, settingsSnapshot, parseSettingsFile } =
  createSettingsValidation(t);
const formContext: SettingsFormContext = {
  state,
  editors,
  order: { buildOrderedList, renderButtonOrder, getButtonOrderFromUI },
  t,
  scheduleAutoSave,
  loadLanguage,
  localizeHeader,
  renderTabs,
  renderActiveTab,
  showSaveFailed,
  showSaved,
  validateMrActions,
  saveDefaultTab: (...args) => saveDefaultTab(...args),
};
const { renderDefaultTab } = createDefaultSettingsForm(formContext);
const { renderProfileTab } = createProfileSettingsForm(formContext);
const { saveDefaultTab, saveProfileTab } =
  createSettingsPersistence(formContext);

if (window.innerWidth > 400) {
  document.addEventListener("DOMContentLoaded", function () {
    document.body.classList.add("fullpage");
  });
}

let _i18nMessages: Record<string, { message: string }> | null = null;

function t(key: string, substitutions?: string[]) {
  // Use manually loaded messages if available
  if (_i18nMessages && _i18nMessages[key]) {
    let msg = _i18nMessages[key].message || "";
    if (substitutions && substitutions.length) {
      for (const [i, substitution] of substitutions.entries()) {
        msg = msg.replace("$" + (i + 1), substitution);
      }
    }
    return msg;
  }
  const msg = chrome.i18n.getMessage(key, substitutions);
  return msg || key;
}

function loadLanguage(lang: string, callback: () => void) {
  if (!lang || lang === "auto") {
    _i18nMessages = null;
    callback();
    return;
  }
  fetch(chrome.runtime.getURL("_locales/" + lang + "/messages.json"))
    .then(function (r) {
      return r.json();
    })
    .then(readMessages)
    .then(function (data) {
      _i18nMessages = data;
      callback();
    })
    .catch(function () {
      _i18nMessages = null;
      callback();
    });
}

function localizeHeader() {
  byId("howLink").textContent = t("howItWorks");
  const openTab = byId("openSettingsTab");
  openTab.title = t("openSettingsInTab");
  openTab.setAttribute("aria-label", t("openSettingsInTab"));
  [
    "exportSettings",
    "importSettings",
    "settingsTransferHint",
    "settingsImportReplace",
    "applySettingsImport",
    "cancelSettingsImport",
  ].forEach(function (key) {
    byId(key).textContent = t(key);
  });
}

let currentProjectPath: string | null = null;

let activeTab = "default";

function detectCurrentProject() {
  return new Promise<void>(function (resolve) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs && tabs[0] && tabs[0].url) {
        const m = tabs[0].url.match(
          /https?:\/\/[^/]+\/(.+?)\/-\/merge_requests/,
        );
        if (m?.[1]) {
          currentProjectPath = m[1];
          const el = byId("currentProject");
          el.textContent = t("current", [currentProjectPath]);
          el.style.display = "";
        }
      }
      resolve();
    });
  });
}

function renderTabs() {
  const container = byId("tabs");
  container.innerHTML =
    '<div class="tab' +
    (activeTab === "default" ? " active" : "") +
    '" data-tab="default">' +
    escHtml(t("default")) +
    "</div>";

  const profiles = state.data.projectProfiles || {};
  Object.keys(profiles).forEach(function (path) {
    const tab = document.createElement("div");
    tab.className = "tab" + (activeTab === path ? " active" : "");
    tab.setAttribute("data-tab", path);
    // Show short name
    const shortName = path.split("/").pop() || path;
    tab.innerHTML =
      escHtml(shortName) +
      '<span class="tab-remove" data-path="' +
      escHtml(path) +
      '">&times;</span>';
    container.appendChild(tab);
  });

  // Tab click handlers
  container.querySelectorAll<HTMLElement>(".tab").forEach(function (tab) {
    tab.addEventListener("click", function (e) {
      if (eventElement(e.target)?.classList.contains("tab-remove")) {
        const path = eventElement(e.target)?.getAttribute("data-path");
        if (path && confirm(t("removeProfile", [path]))) {
          if (!flushAutoSave()) return;
          delete profiles[path];
          if (activeTab === path) activeTab = "default";
          renderTabs();
          renderActiveTab();
        }
        return;
      }
      if (!flushAutoSave()) return;
      activeTab = tab.getAttribute("data-tab") || "default";
      renderTabs();
      renderActiveTab();
    });
  });

  // Show/hide add profile button
  const addBtn = byId("addProfile");
  if (currentProjectPath && !profiles[currentProjectPath]) {
    addBtn.style.display = "";
    addBtn.textContent = t("addProfileFor", [
      currentProjectPath.split("/").pop() || currentProjectPath,
    ]);
  } else {
    addBtn.style.display = "none";
  }
}

function renderActiveTab() {
  const contentEl = requireElement(
    document.querySelector<HTMLElement>(".tab-content"),
  );
  if (activeTab === "default") {
    renderDefaultTab(contentEl);
  } else {
    renderProfileTab(contentEl, activeTab);
  }
}

function saveSettings(
  onSaved?: (() => void) | null,
  onFailed?: (() => void) | null,
) {
  if (typeof onSaved !== "function") onSaved = null;
  if (typeof onFailed !== "function") onFailed = null;
  if (activeTab === "default") {
    const saved = saveDefaultTab(onSaved, onFailed);
    if (saved) _autoSaveDirty = false;
    return saved;
  } else {
    const saved = saveProfileTab(activeTab, onSaved, onFailed);
    if (saved) _autoSaveDirty = false;
    return saved;
  }
}

let _statusTimer: ReturnType<typeof setTimeout> | null = null;

let _statusHideTimer: ReturnType<typeof setTimeout> | null = null;

function clearStatusTimers() {
  clearTimeout(_statusTimer ?? undefined);
  clearTimeout(_statusHideTimer ?? undefined);
}

function showSaveFailed(message?: string) {
  clearStatusTimers();
  const status = byId("status");
  status.textContent = message || t("settingsSaveFailed");
  status.className = "status failed";
  status.style.display = "block";
  status.style.opacity = "1";
}

function showSaved(saveVersion?: number) {
  // lastError must be read inside the storage callback, even for stale saves.
  const failed = !!chrome.runtime.lastError;
  if (typeof saveVersion === "number" && saveVersion !== state.statusVersion)
    return;
  if (failed) {
    showSaveFailed();
    return;
  }
  clearStatusTimers();
  const status = byId("status");
  status.textContent = t("saved");
  status.className = "status saved";
  status.style.display = "block";
  status.style.opacity = "1";
  _statusTimer = setTimeout(function () {
    status.style.opacity = "0";
    _statusHideTimer = setTimeout(function () {
      status.style.display = "none";
    }, SAVE_STATUS_FADE_MS);
  }, SAVE_STATUS_DURATION_MS);
}

let _autoSaveDirty = false;

function flushAutoSave() {
  if (state.autoSaveTimer === null && !_autoSaveDirty) return true;
  clearTimeout(state.autoSaveTimer ?? undefined);
  state.autoSaveTimer = null;
  return saveSettings();
}

function scheduleAutoSave() {
  if (state.autoSaveTimer) clearTimeout(state.autoSaveTimer ?? undefined);
  _autoSaveDirty = true;
  state.statusVersion++;
  clearStatusTimers();
  const status = byId("status");
  status.textContent = t("unsavedChanges");
  status.className = "status unsaved";
  status.style.display = "block";
  status.style.opacity = "1";
  state.autoSaveTimer = setTimeout(function () {
    state.autoSaveTimer = null;
    saveSettings();
  }, AUTOSAVE_DEBOUNCE_MS);
}

function attachAutoSave() {
  // Listen for all input changes in the popup
  document.body.addEventListener("input", function (e) {
    if (
      eventElement(e.target)?.id !== "settingsImportFile" &&
      eventElement(e.target)?.matches("input, select, textarea")
    )
      scheduleAutoSave();
  });
  document.body.addEventListener("change", function (e) {
    if (
      eventElement(e.target)?.id !== "settingsImportFile" &&
      eventElement(e.target)?.matches("input, select, textarea")
    )
      scheduleAutoSave();
  });
}

let _pendingSettingsImport: Settings | null = null;

let _settingsTransferBusy = false;

function setSettingsTransferBusy(busy: boolean) {
  _settingsTransferBusy = busy;
  [
    "exportSettings",
    "importSettings",
    "applySettingsImport",
    "cancelSettingsImport",
    "openSettingsTab",
    "addProfile",
  ].forEach(function (id) {
    buttonById(id).disabled = busy;
  });
  byId("tabs").inert = busy;
  requireElement(document.querySelector<HTMLElement>(".tab-content")).inert =
    busy;
}

function exportAllSettings() {
  if (_settingsTransferBusy) return;
  clearTimeout(state.autoSaveTimer ?? undefined);
  state.autoSaveTimer = null;
  setSettingsTransferBusy(true);
  // Wait for the current form to reach storage before reading the complete set.
  if (
    !saveSettings(
      function () {
        chrome.storage.sync.get(Object.keys(DEFAULTS), function (data) {
          if (chrome.runtime.lastError) {
            setSettingsTransferBusy(false);
            showSaveFailed(t("settingsExportFailed"));
            return;
          }
          try {
            const file = {
              format: "gitlab-mr-actions-settings",
              formatVersion: 1,
              extensionVersion: chrome.runtime.getManifest().version,
              settings: settingsSnapshot(data),
            };
            const url = URL.createObjectURL(
              new Blob([JSON.stringify(file, null, 2)], {
                type: "application/json",
              }),
            );
            const link = document.createElement("a");
            link.href = url;
            link.download = "gitlab-mr-actions-settings.json";
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(function () {
              URL.revokeObjectURL(url);
            }, DOWNLOAD_URL_LIFETIME_MS);
          } catch {
            showSaveFailed(t("settingsExportFailed"));
          }
          setSettingsTransferBusy(false);
        });
      },
      function () {
        setSettingsTransferBusy(false);
      },
    )
  )
    setSettingsTransferBusy(false);
}

function readSettingsImport(file: File | undefined) {
  _pendingSettingsImport = null;
  byId("settingsImportPreview").hidden = true;
  if (!file) return;
  if (file.size > SETTINGS_FILE_MAX_BYTES) {
    showSaveFailed(t("settingsFileTooLarge"));
    return;
  }
  const reader = new FileReader();
  reader.onload = function () {
    try {
      _pendingSettingsImport = parseSettingsFile(String(reader.result));
      byId("settingsImportSummary").textContent = t("settingsImportSummary", [
        file.name,
        String(Object.keys(_pendingSettingsImport.projectProfiles).length),
      ]);
      byId("settingsImportPreview").hidden = false;
      byId("applySettingsImport").focus();
    } catch (error) {
      showSaveFailed(
        (error instanceof Error ? error.message : String(error)) ||
          t("settingsFileInvalid"),
      );
    }
  };
  reader.onerror = function () {
    showSaveFailed(t("settingsFileInvalid"));
  };
  reader.readAsText(file);
}

function applySettingsImport() {
  if (!_pendingSettingsImport || _settingsTransferBusy) return;
  const settings = _pendingSettingsImport;
  function fail(message?: string) {
    setSettingsTransferBusy(false);
    showSaveFailed(message || t("settingsImportFailed"));
  }
  function write() {
    clearTimeout(state.autoSaveTimer ?? undefined);
    state.autoSaveTimer = null;
    chrome.storage.sync.get(null, function (stored) {
      if (chrome.runtime.lastError) {
        fail();
        return;
      }
      const combined = Object.assign({}, stored, settings);
      const bytes = Object.keys(combined).reduce(function (total, key) {
        return (
          total +
          new TextEncoder().encode(key + JSON.stringify(combined[key])).length
        );
      }, 0);
      if (bytes > 102400 || Object.keys(combined).length > 512) {
        fail(t("settingsFileTooLarge"));
        return;
      }
      // One write replaces configuration, preserving unrelated extension state.
      chrome.storage.sync.set(settings, function () {
        if (chrome.runtime.lastError) {
          fail();
          return;
        }
        _autoSaveDirty = false;
        state.statusVersion++;
        state.data = settings;
        activeTab = "default";
        _pendingSettingsImport = null;
        byId("settingsImportPreview").hidden = true;
        loadLanguage(settings.language, function () {
          localizeHeader();
          renderTabs();
          renderActiveTab();
          setSettingsTransferBusy(false);
          showSaved();
          byId("status").textContent = t("settingsImported");
        });
      });
    });
  }
  setSettingsTransferBusy(true);
  if (settings.jira_url) {
    // Keep the permission request attached to the explicit Apply click.
    chrome.permissions.request(
      { origins: [new URL(settings.jira_url).origin + "/*"] },
      function (granted) {
        if (chrome.runtime.lastError || !granted) {
          fail(t("settingsImportPermissionDenied"));
          return;
        }
        write();
      },
    );
  } else write();
}

export function startSettings() {
  document.addEventListener("DOMContentLoaded", function () {
    // Load language setting first, then render everything
    chrome.storage.sync.get(
      { language: "auto" },
      function (langData: { language: string }) {
        loadLanguage(langData.language, function () {
          // Apply i18n to static elements
          localizeHeader();

          // Show update banner if extension was just updated
          chrome.storage.sync.get(
            { update_version: "", update_dismissed: "" },
            function (ud: {
              update_version: string;
              update_dismissed: string;
            }) {
              if (!ud.update_version) return;
              if (ud.update_dismissed === ud.update_version) return;
              const banner = byId("updateBanner");
              const isRu =
                langData.language === "ru" ||
                ((!langData.language || langData.language === "auto") &&
                  (chrome.i18n.getUILanguage() || "").startsWith("ru"));
              const changelogUrl =
                CHANGELOG_BASE_URL +
                (isRu ? "CHANGELOG_RU.md" : "CHANGELOG.md");
              const reviewUrl = STORE_REVIEWS_URL;
              banner.innerHTML =
                '<button class="update-close" id="updateClose">&times;</button>' +
                '<span class="update-version">v' +
                escHtml(ud.update_version) +
                "</span><br>" +
                escHtml(t("updateBannerText")) +
                '<br><a href="' +
                changelogUrl +
                '" target="_blank">' +
                escHtml(t("updateChangelog")) +
                "</a>" +
                '<span class="update-review">' +
                escHtml(t("updateReviewAsk")) +
                " " +
                '<a href="' +
                reviewUrl +
                '" target="_blank">' +
                escHtml(t("updateReviewLink")) +
                "</a></span>";
              banner.style.display = "block";
              byId("updateClose").addEventListener("click", function () {
                banner.style.display = "none";
                chrome.storage.sync.set(
                  {
                    update_dismissed: ud.update_version,
                  },
                  reportRuntimeError,
                );
                chrome.action.setBadgeText({ text: "" }, reportRuntimeError);
              });
              // Clear badge when popup is opened
              chrome.action.setBadgeText({ text: "" }, reportRuntimeError);
            },
          );

          detectCurrentProject()
            .then(function () {
              chrome.storage.sync.get(Object.keys(DEFAULTS), function (data) {
                state.data = data;
                renderTabs();
                renderActiveTab();

                // Auto-switch to current project's profile if it exists
                if (
                  currentProjectPath &&
                  state.data.projectProfiles &&
                  state.data.projectProfiles[currentProjectPath]
                ) {
                  activeTab = currentProjectPath;
                  renderTabs();
                  renderActiveTab();
                }
                buttonById("openSettingsTab").disabled = false;
                buttonById("exportSettings").disabled = false;
                buttonById("importSettings").disabled = false;
              });
            })
            .catch(reportError);
        });
      },
    );

    byId("addProfile").addEventListener("click", function () {
      if (!currentProjectPath) return;
      if (!flushAutoSave()) return;
      if (!state.data.projectProfiles) state.data.projectProfiles = {};
      // Create profile with current defaults
      state.data.projectProfiles[currentProjectPath] = {
        buttons: {},
        buttonOrder: [],
        reviewersJob: "",
        customJobs: [],
      };
      activeTab = currentProjectPath;
      renderTabs();
      renderActiveTab();
      scheduleAutoSave();
    });

    byId("save").addEventListener("click", () => saveSettings());
    byId("openSettingsTab").addEventListener("click", function () {
      clearTimeout(state.autoSaveTimer ?? undefined);
      state.autoSaveTimer = null;
      saveSettings(function () {
        chrome.tabs.create(
          { url: chrome.runtime.getURL(SETTINGS_PAGE) },
          reportRuntimeError,
        );
      });
    });
    byId("exportSettings").addEventListener("click", exportAllSettings);
    byId("importSettings").addEventListener("click", function () {
      const input = inputById("settingsImportFile");
      input.value = "";
      input.click();
    });
    byId("settingsImportFile").addEventListener("change", function () {
      readSettingsImport(inputById("settingsImportFile").files?.[0]);
    });
    byId("applySettingsImport").addEventListener("click", applySettingsImport);
    byId("cancelSettingsImport").addEventListener("click", function () {
      _pendingSettingsImport = null;
      byId("settingsImportPreview").hidden = true;
      byId("importSettings").focus();
    });
    attachAutoSave();
  });
}
