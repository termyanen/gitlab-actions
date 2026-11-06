import {
  BUILTIN_BUTTONS,
  BUTTON_DEFAULTS,
} from "../../../features/manage-settings";
import { byId, escHtml } from "./dom";
import type { SettingsFormContext } from "./form-context";
export function createProfileSettingsForm(context: SettingsFormContext) {
  const { state, t, scheduleAutoSave } = context;
  const { buildOrderedList, renderButtonOrder } = context.order;
  const {
    renderCustomJobs,
    mrActionsSection,
    setupMrActions,
    getCustomJobsFromUI,
    rebuildButtonOrderCustom,
  } = context.editors;

  function renderProfileTab(container: HTMLElement, path: string) {
    const profile = (state.data.projectProfiles || {})[path] || {};
    container.innerHTML =
      "<h4>" +
      escHtml(t("buttonsFor", [path.split("/").pop()!])) +
      "</h4>" +
      '<div class="hint" style="margin-bottom:6px">' +
      escHtml(t("overrideHint")) +
      "</div>" +
      '<div id="profileButtonOrder"></div>' +
      '<div class="sep"></div>' +
      "<h4>" +
      escHtml(t("versionBump")) +
      "</h4>" +
      '<div class="hint" style="margin-bottom:6px">' +
      escHtml(t("leaveEmptyDefault")) +
      "</div>" +
      '<div class="field"><label>' +
      escHtml(t("filePath")) +
      "</label>" +
      '<select id="profileVersionFilePreset" style="margin-bottom:4px">' +
      '<option value="">(' +
      escHtml(t("default")) +
      ")</option>" +
      '<option value="package.json">package.json</option>' +
      '<option value="pyproject.toml">pyproject.toml</option>' +
      '<option value="__custom__">' +
      escHtml(t("customFile")) +
      "</option>" +
      "</select>" +
      '<input type="text" id="profileVersionFile" placeholder="path/to/file" style="display:none"></div>' +
      '<div class="field" id="profileVersionPathField"><label>' +
      escHtml(t("versionField")) +
      '</label><input type="text" id="profileVersionPath" placeholder="(' +
      escHtml(t("default")) +
      ')"><div class="hint">' +
      escHtml(t("versionFieldHint")) +
      "</div></div>" +
      '<div class="field"><label>' +
      escHtml(t("strategy")) +
      "</label>" +
      '<select id="profileVersionStrategy">' +
      '<option value="">(' +
      escHtml(t("default")) +
      ")</option>" +
      '<option value="patch">' +
      escHtml(t("strategyPatch")) +
      "</option>" +
      '<option value="minor">' +
      escHtml(t("strategyMinor")) +
      "</option>" +
      '<option value="major">' +
      escHtml(t("strategyMajor")) +
      "</option>" +
      "</select></div>" +
      '<div class="field"><label>' +
      escHtml(t("commitMessage")) +
      '</label><input type="text" id="profileVersionCommitTemplate" placeholder="(' +
      escHtml(t("default")) +
      ')"><div class="hint">' +
      escHtml(t("commitMessageHint")) +
      "</div></div>" +
      '<div class="sep"></div>' +
      "<h4>" +
      escHtml(t("reviewers")) +
      "</h4>" +
      '<div class="field"><label>' +
      escHtml(t("reviewersList")) +
      '</label><input type="text" id="profileReviewersList" placeholder="(' +
      escHtml(t("leaveEmptyDefault")) +
      ')"><div class="hint">' +
      escHtml(t("reviewersListHint")) +
      "</div></div>" +
      '<div class="field"><label>' +
      escHtml(t("jobName")) +
      '</label><input type="text" id="profileReviewersJob" placeholder="(' +
      escHtml(t("leaveEmptyDefault")) +
      ')"><div class="hint">' +
      escHtml(t("leaveEmptyDefault")) +
      "</div></div>" +
      '<div class="sep"></div>' +
      "<h4>" +
      escHtml(t("customJobButtons")) +
      "</h4>" +
      '<div class="hint" style="margin-bottom:8px">' +
      escHtml(t("projectSpecificJobs")) +
      "</div>" +
      '<div id="profileCustomJobsList"></div>' +
      '<button class="add-btn" id="profileAddCustomJob">' +
      escHtml(t("addJobButton")) +
      "</button>" +
      mrActionsSection("profileMrActionsList", "profileAddMrAction", true);

    // Build enabled map from profile, falling back to defaults
    const enabledMap: Record<string, boolean> = {};
    BUILTIN_BUTTONS.forEach(function (b) {
      const profileVal = profile.buttons && profile.buttons[b.key];
      enabledMap[b.key] =
        profileVal !== undefined
          ? profileVal
          : state.data[b.key] !== undefined
            ? !!state.data[b.key]
            : (BUTTON_DEFAULTS as Record<string, boolean>)[b.key];
    });

    const customJobs = profile.customJobs || [];
    const ordered = buildOrderedList(
      profile.buttonOrder || state.data.buttonOrder || [],
      enabledMap,
      customJobs,
      profile.mrActions || state.data.mrActions || [],
    );
    renderButtonOrder(ordered, "profileButtonOrder");
    renderCustomJobs(customJobs, "profileCustomJobsList", "profileButtonOrder");
    setupMrActions(
      profile.mrActions || state.data.mrActions || [],
      "profileMrActionsList",
      "profileAddMrAction",
      "profileButtonOrder",
    );

    // Version bump fields
    const pVersionFile = profile.versionFile || "";
    const pPresetEl = byId<HTMLInputElement>("profileVersionFilePreset");
    const pCustomInput = byId<HTMLInputElement>("profileVersionFile");
    const pVersionPathField = byId("profileVersionPathField");
    const knownPresets = ["package.json", "pyproject.toml"];
    if (pVersionFile && knownPresets.indexOf(pVersionFile) !== -1) {
      pPresetEl.value = pVersionFile;
    } else if (pVersionFile) {
      pPresetEl.value = "__custom__";
      pCustomInput.style.display = "";
      pCustomInput.value = pVersionFile;
    } else {
      pPresetEl.value = "";
    }
    // Hide path field for plain text
    function updateProfilePathVisibility() {
      const v = pPresetEl.value;
      if (v === "__custom__") {
        const ext = (pCustomInput.value || "").split(".").pop()!.toLowerCase();
        pVersionPathField.style.display =
          ext === "txt" || ext === "text" ? "none" : "";
      } else {
        pVersionPathField.style.display = "";
      }
    }
    pPresetEl.addEventListener("change", function () {
      pCustomInput.style.display =
        pPresetEl.value === "__custom__" ? "" : "none";
      updateProfilePathVisibility();
      scheduleAutoSave();
    });
    pCustomInput.addEventListener("input", function () {
      updateProfilePathVisibility();
      scheduleAutoSave();
    });
    updateProfilePathVisibility();

    byId<HTMLInputElement>("profileVersionPath").value =
      profile.versionPath || "";
    byId<HTMLInputElement>("profileVersionStrategy").value =
      profile.versionStrategy || "";
    byId<HTMLInputElement>("profileVersionCommitTemplate").value =
      profile.versionCommitTemplate || "";

    byId<HTMLInputElement>("profileReviewersList").value =
      profile.reviewersList || "";
    byId<HTMLInputElement>("profileReviewersJob").value =
      profile.reviewersJob || "";

    byId("profileAddCustomJob").addEventListener("click", function () {
      const current = getCustomJobsFromUI("profileCustomJobsList");
      current.push({ label: "", jobName: "" });
      renderCustomJobs(current, "profileCustomJobsList", "profileButtonOrder");
      rebuildButtonOrderCustom("profileButtonOrder", "profileCustomJobsList");
    });
  }
  return { renderProfileTab };
}
