import {
  applyProjectSettings,
  findSettingsProfileKey,
} from "../../../shared/api/project-settings";
import { categories } from "../../../shared/config/settings-navigation";
import type { Category } from "../../../shared/config/settings-navigation";
import { lazy, Suspense, useRef, useState } from "react";
import { ReleaseNotice } from "../../../features/view-release-notes";
import { reportRuntimeError } from "../../../shared/api/runtime";
import { SETTINGS_PAGE, WELCOME_PAGE } from "../../../shared/config/extension";
import { readJiraBaseUrl } from "../../../shared/config/jira";
import { mountReactPage } from "../../../shared/lib/react-page";
import { useUiLanguage } from "../../../shared/lib/ui-language";
import {
  SettingsBrand,
  SettingsButton,
  SettingsLink,
  SaveStatus,
  Toggle,
} from "../../../shared/ui/settings";
import { quickSettings, usePopup } from "../model/use-popup";

import { PopupDisclosure } from "./disclosure";

const JiraAccessSummary = lazy(() => import("./jira-summary"));

function Popup() {
  const state = usePopup();
  const frame = useRef<HTMLIFrameElement>(null);
  const [readyOrigin, setReadyOrigin] = useState<string>();
  const [editorUrl, setEditorUrl] = useState("");
  const [section, setSection] = useState<Category | null>(null);
  const selectSection = (category: Category) => {
    if (section === category) {
      setSection(null);
      return;
    }
    setSection(category);
    if (editorUrl) {
      if (frame.current?.contentWindow)
        frame.current.contentWindow.location.hash = new URLSearchParams({
          section: category,
        }).toString();
    } else {
      const url = new URL(chrome.runtime.getURL(SETTINGS_PAGE));
      if (state.project) url.searchParams.set("project", state.project);
      url.searchParams.set("embedded", "1");
      url.hash = new URLSearchParams({ section: category }).toString();
      setEditorUrl(url.href);
    }
  };
  const { t, language, loading } = useUiLanguage(state.data.language);
  const open = (section: Category = "actions") => {
    const url = new URL(chrome.runtime.getURL(SETTINGS_PAGE));
    if (state.project) url.searchParams.set("project", state.project);
    url.hash = new URLSearchParams({ section }).toString();
    chrome.tabs.create({ url: url.href }, reportRuntimeError);
  };
  if (state.failed)
    return (
      <>
        <SaveStatus
          className="popup-status"
          kind="failed"
          message={t("settingsLoadFailed")}
        />
        <SettingsButton onClick={() => location.reload()}>
          {t("aiReviewRetry")}
        </SettingsButton>
      </>
    );
  if (state.loading || (loading && !editorUrl)) return null;
  const hasProfile = findSettingsProfileKey(
    state.data.projectProfiles,
    state.project || null,
  );
  const effective = applyProjectSettings(
    { jira_url: "", ...state.data },
    state.data.projectProfiles,
    state.project || null,
  );
  const jira =
    typeof effective.jira_url === "string"
      ? readJiraBaseUrl(effective.jira_url)
      : undefined;
  const statusKind =
    state.status === "settingsSaveFailed"
      ? "failed"
      : state.status === "settingsSaving"
        ? "unsaved"
        : state.status === "saved"
          ? "saved"
          : "";
  return (
    <div hidden={!!jira && readyOrigin !== jira.origin}>
      <header className="popup-header">
        <SettingsBrand />
      </header>
      <main className="popup-body">
        <ReleaseNotice language={language} t={t} />
        {jira && (
          <Suspense fallback={null}>
            <PopupDisclosure
              name="jira"
              title={`Jira · ${new URL(jira.origin).host}`}
            >
              <JiraAccessSummary {...jira} t={t} onReady={setReadyOrigin} />
            </PopupDisclosure>
          </Suspense>
        )}
        <PopupDisclosure
          name="scope"
          className="project-card"
          title={
            <strong title={!state.project ? t("settingsNoProject") : undefined}>
              {state.project || t("settingsGlobal")}
            </strong>
          }
        >
          <p className="hint">
            {t(hasProfile ? "settingsProjectHint" : "settingsGlobalHint")}
          </p>
        </PopupDisclosure>
        <section className="popup-quick">
          <h2>{t("settingsQuick")}</h2>
          {hasProfile && <p className="hint">{t("settingsGlobalHint")}</p>}
          {quickSettings.map((setting) => (
            <Toggle
              key={setting.key}
              id={setting.key}
              label={t(setting.label)}
              checked={
                typeof state.data[setting.key] === "boolean"
                  ? state.data[setting.key] === true
                  : setting.fallback
              }
              disabled={state.pending.has(setting.key)}
              onChange={(checked) => state.toggle(setting.key, checked)}
            />
          ))}
        </section>
        <nav className="popup-shortcuts" aria-label={t("settingsTitle")}>
          {categories.map(([id, key]) => (
            <SettingsButton
              key={id}
              icon={id}
              data-category={id}
              aria-controls="popupSettingsEditor"
              aria-expanded={section === id}
              onClick={() => selectSection(id)}
            >
              {t(key)}
            </SettingsButton>
          ))}
          <SettingsLink
            href={WELCOME_PAGE}
            target="_blank"
            rel="noopener"
            icon="external"
          >
            {t("howItWorks")}
          </SettingsLink>
        </nav>
        {editorUrl && (
          <iframe
            hidden={section === null}
            ref={frame}
            id="popupSettingsEditor"
            className="popup-settings-editor"
            title={t("settingsTitle")}
            src={editorUrl}
            onLoad={() => {
              if (section && frame.current?.contentWindow)
                frame.current.contentWindow.location.hash = new URLSearchParams(
                  { section },
                ).toString();
            }}
          />
        )}
      </main>
      <footer className="popup-footer">
        <SaveStatus
          className="popup-status"
          kind={statusKind}
          message={state.status ? t(state.status) : ""}
        />
        <SettingsButton
          className="primary"
          icon="external"
          onClick={() => open()}
        >
          {t("settingsAll")}
        </SettingsButton>
      </footer>
    </div>
  );
}

export function startPopup() {
  mountReactPage(<Popup />, "popupRoot");
}
