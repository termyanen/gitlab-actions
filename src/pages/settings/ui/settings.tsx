import { categories } from "../../../shared/config/settings-navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  SettingsBrand,
  SettingsButton,
  SettingsLink,
  SaveStatus,
} from "../../../shared/ui/settings";
import { mountReactPage } from "../../../shared/lib/react-page";
import { WELCOME_PAGE } from "../../../shared/config/extension";
import { useUiLanguage } from "../../../shared/lib/ui-language";
import { ReleaseNotice } from "../../../features/view-release-notes";
import { reportError } from "../../../shared/lib/errors";
import { SettingsController } from "../model/controller";
import type { SettingsState } from "../model/controller";
import { effectiveScope, matchesSection } from "../model/navigation";
import { SettingsFormContext } from "./form-controls";
import { DefaultForm, defaultSections } from "./default-form";
import { ProfileForm, allProfileSections } from "./profile-form";
import type { Translate } from "../model/draft";

function run(promise: Promise<unknown>) {
  promise.catch(reportError);
}
function SettingsTransfer({
  controller,
  state,
  t,
  visible,
}: {
  controller: SettingsController;
  state: SettingsState;
  t: Translate;
  visible: boolean;
}) {
  const file = useRef<HTMLInputElement>(null);
  const apply = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (state.preview) apply.current?.focus();
  }, [state.preview]);
  return (
    <div className="settings-transfer" id="settingsTransfer" hidden={!visible}>
      <div className="settings-transfer-actions">
        <SettingsButton
          className="add-btn"
          id="exportSettings"
          disabled={state.busy || !state.loaded}
          onClick={() => run(controller.exportSettings())}
        >
          {t("exportSettings")}
        </SettingsButton>
        <SettingsButton
          className="add-btn"
          id="importSettings"
          disabled={state.busy || !state.loaded}
          onClick={() => {
            if (file.current) {
              file.current.value = "";
              file.current.click();
            }
          }}
        >
          {t("importSettings")}
        </SettingsButton>
      </div>
      <div className="hint" id="settingsTransferHint">
        {t("settingsTransferHint")}
      </div>
      <input
        ref={file}
        type="file"
        id="settingsImportFile"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const selected = e.currentTarget.files?.[0];
          if (selected) run(controller.readImport(selected));
        }}
      />
      <div
        className="settings-import-preview"
        id="settingsImportPreview"
        hidden={!state.preview}
      >
        <p id="settingsImportSummary">
          {state.preview
            ? t("settingsImportSummary", [
                state.preview.name,
                String(
                  Object.keys(state.preview.settings.projectProfiles).length,
                ),
              ])
            : ""}
        </p>
        <p id="settingsImportReplace">{t("settingsImportReplace")}</p>
        <div className="settings-transfer-actions">
          <button
            ref={apply}
            type="button"
            id="applySettingsImport"
            disabled={state.busy}
            onClick={() => controller.applyImport()}
          >
            {t("applySettingsImport")}
          </button>
          <SettingsButton
            className="add-btn"
            id="cancelSettingsImport"
            disabled={state.busy}
            onClick={() => {
              controller.cancelImport();
              document.getElementById("importSettings")?.focus();
            }}
          >
            {t("cancelSettingsImport")}
          </SettingsButton>
        </div>
      </div>
    </div>
  );
}
function isEmbeddedSettings() {
  return (
    window.parent !== window &&
    new URLSearchParams(location.search).get("embedded") === "1"
  );
}

export function SettingsPage() {
  const [controller] = useState(
    () =>
      new SettingsController(
        (key, substitutions) =>
          chrome.i18n.getMessage(key, substitutions) || key,
      ),
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  const { t, language, loading } = useUiLanguage(state.data?.language);
  const search = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const scope = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    run(controller.start());
    return () => controller.dispose();
  }, [controller]);
  useEffect(() => {
    controller.setTranslator(t);
    document.title = t("settingsTitle") + " · GitLab MR Actions";
  }, [controller, t]);
  useEffect(() => {
    if (!isEmbeddedSettings()) return;
    const navigate = () => {
      const selected = new URLSearchParams(location.hash.slice(1)).get(
        "section",
      );
      const category = categories.find(([id]) => id === selected)?.[0];
      if (category)
        run(
          controller.navigate({ category, search: "" }).then((changed) => {
            if (changed) window.scrollTo(0, 0);
          }),
        );
    };
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, [controller]);
  useEffect(() => {
    if (!isEmbeddedSettings()) return;
    const frame = window.frameElement;
    const content = document.querySelector(".settings-shell");
    if (frame?.localName !== "iframe" || !content) return;
    const resize = () => {
      const height = Math.ceil(content.getBoundingClientRect().height);
      if (height > 0) frame.setAttribute("style", `height: ${height}px`);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(content);
    resize();
    return () => observer.disconnect();
  }, []);
  const rendered = effectiveScope(state.scope, state.category, state.search);
  const global = rendered === "default";
  const ready = state.loaded && !loading;
  const disabled = !ready || state.busy;
  const transferVisible = state.search.trim()
    ? [
        "settingsData",
        "exportSettings",
        "importSettings",
        "settingsTransferHint",
      ]
        .map((k) => t(k))
        .join(" ")
        .toLocaleLowerCase()
        .includes(state.search.trim().toLocaleLowerCase())
    : state.category === "data";
  const found =
    (global ? defaultSections : allProfileSections).some((meta) =>
      matchesSection(meta, state.category, state.search, t),
    ) || transferVisible;
  const headingKey = state.search.trim()
    ? "settingsSearch"
    : categories.find(([id]) => id === state.category)?.[1] || "settingsTitle";
  const status =
    isEmbeddedSettings() && state.status.key === "settingsAutosaveHint"
      ? ""
      : state.status.message || (state.status.key ? t(state.status.key) : "");
  return (
    <div className="settings-shell">
      <aside className="settings-sidebar">
        <div id="settingsBrand">
          <SettingsBrand />
        </div>
        <div className="settings-search">
          <input
            ref={search}
            id="settingsSearch"
            type="search"
            autoComplete="off"
            disabled={disabled}
            value={state.search}
            placeholder={t("settingsSearch")}
            aria-label={t("settingsSearch")}
            onChange={(event) => {
              const value = event.currentTarget.value;
              run(
                controller
                  .navigate({ search: value })
                  .then(() => search.current?.focus()),
              );
            }}
          />
        </div>
        <nav id="settingsNav" aria-label={t("settingsTitle")}>
          {categories.map(([id, key]) => (
            <SettingsButton
              key={id}
              icon={id}
              data-category={id}
              disabled={disabled}
              aria-current={
                !state.search.trim() && state.category === id ? "page" : "false"
              }
              onClick={() =>
                run(
                  controller
                    .navigate({ category: id, search: "" })
                    .then((accepted) => {
                      if (accepted) heading.current?.focus();
                    }),
                )
              }
            >
              {t(key)}
            </SettingsButton>
          ))}
          <SettingsLink
            href={WELCOME_PAGE}
            target="_blank"
            rel="noopener"
            icon="external"
            id="howLink"
          >
            {t("howItWorks")}
          </SettingsLink>
        </nav>
      </aside>
      <main className="settings-main">
        <div className="workspace-bar">
          <span id="currentProject" hidden={!state.currentProject}>
            {state.currentProject ? t("current", [state.currentProject]) : ""}
          </span>
          <div className="save-feedback">
            <SaveStatus id="status" kind={state.status.kind} message={status} />
            <SettingsButton
              id="retrySave"
              hidden={state.status.kind !== "failed"}
              disabled={state.busy}
              onClick={() =>
                state.loaded ? run(controller.save()) : location.reload()
              }
            >
              {t("aiReviewRetry")}
            </SettingsButton>
          </div>
          <SettingsButton
            id="openSettingsTab"
            title={t("openSettingsInTab")}
            aria-label={t("openSettingsInTab")}
            disabled={disabled}
            onClick={() => run(controller.openSettings())}
          >
            ↗
          </SettingsButton>
        </div>
        {!isEmbeddedSettings() && (
          <ReleaseNotice id="updateBanner" language={language} t={t} />
        )}
        <header className="page-heading">
          <h1 id="settingsHeading" tabIndex={-1} ref={heading}>
            {t(headingKey)}
          </h1>
          <p id="settingsDescription" className="hint">
            {!state.search.trim() && state.category === "actions"
              ? t("settingsActionsHint")
              : ""}
          </p>
        </header>
        <div className="scope-bar">
          <label htmlFor="profileScope" id="scopeLabel">
            {t("settingsScope")}
          </label>
          <div id="tabs" inert={disabled}>
            {state.data && (
              <select
                id="profileScope"
                ref={scope}
                value={state.scope}
                data-effective-profile={!global}
                onChange={(e) =>
                  run(
                    controller
                      .navigate({ scope: e.currentTarget.value })
                      .then(() => scope.current?.focus()),
                  )
                }
              >
                <option value="default">{t("settingsGlobal")}</option>
                {Object.keys(state.data.projectProfiles).map((path) => (
                  <option key={path} value={path}>
                    {path}
                  </option>
                ))}
              </select>
            )}
            {state.scope !== "default" && (
              <SettingsButton
                className="remove-profile"
                onClick={() => {
                  if (confirm(t("removeProfile", [state.scope])))
                    run(controller.removeProfile());
                }}
              >
                {t("settingsRemoveProfile")}
              </SettingsButton>
            )}
          </div>
          <p className="hint" id="scopeHint">
            {t(global ? "settingsGlobalHint" : "settingsProjectHint")}
          </p>
          <SettingsButton
            id="addProfile"
            className="add-btn"
            hidden={
              !state.currentProject ||
              !state.data ||
              Object.hasOwn(state.data.projectProfiles, state.currentProject)
            }
            disabled={disabled}
            onClick={() => run(controller.addProfile())}
          >
            {t("addProfileFor", [state.currentProject || ""])}
          </SettingsButton>
        </div>
        <p
          className="settings-notice"
          id="globalOnlyHint"
          hidden={state.scope === "default" || !global}
        >
          {t("settingsGlobalOnly")}
        </p>
        <p id="settingsNoResults" role="status" hidden={!ready || found}>
          {t("settingsNoResults")}
        </p>
        <div
          className="tab-content active"
          inert={disabled}
          aria-busy={state.busy}
        >
          {ready && state.data && state.draft && (
            <SettingsFormContext
              value={{
                draft: state.draft,
                update: controller.updateDraft,
                t,
                category: state.category,
                search: state.search,
                profile: !global,
              }}
            >
              {global ? (
                <DefaultForm />
              ) : (
                <ProfileForm scope={rendered} data={state.data} />
              )}
            </SettingsFormContext>
          )}
        </div>
        <SettingsTransfer
          controller={controller}
          state={state}
          t={t}
          visible={ready && transferVisible}
        />
      </main>
    </div>
  );
}
export function startSettings() {
  if (isEmbeddedSettings()) document.body.classList.add("embedded-settings");
  mountReactPage(<SettingsPage />, "settingsRoot");
}
