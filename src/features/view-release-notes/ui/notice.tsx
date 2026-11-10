import { useEffect, useState } from "react";
import { reportRuntimeError } from "../../../shared/api/runtime";
import {
  CHANGELOG_BASE_URL,
  STORE_REVIEWS_URL,
} from "../../../shared/config/extension";
import type { UiTranslate } from "../../../shared/lib/ui-language";

interface NoticeState {
  version: string;
  dismissed: string;
}

export function ReleaseNotice({
  language,
  t,
  id,
}: {
  language: string;
  t: UiTranslate;
  id?: string;
}) {
  const [notice, setNotice] = useState<NoticeState>({
    version: "",
    dismissed: "",
  });
  useEffect(() => {
    let active = true;
    const changesSinceRead: Record<string, unknown> = {};
    chrome.storage.sync.get(
      { update_version: "", update_dismissed: "" },
      (data) => {
        const failed = !!chrome.runtime.lastError;
        if (failed || !active) return;
        const current = { ...data, ...changesSinceRead };
        setNotice({
          version:
            typeof current.update_version === "string"
              ? current.update_version
              : "",
          dismissed:
            typeof current.update_dismissed === "string"
              ? current.update_dismissed
              : "",
        });
      },
    );
    const changed = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== "sync" || !active) return;
      if (!changes.update_version && !changes.update_dismissed) return;
      for (const key of ["update_version", "update_dismissed"]) {
        const change = changes[key];
        if (change) changesSinceRead[key] = change.newValue;
      }
      setNotice((previous) => {
        const version: unknown = changes.update_version?.newValue;
        const dismissed: unknown = changes.update_dismissed?.newValue;
        return {
          version: changes.update_version
            ? typeof version === "string"
              ? version
              : ""
            : previous.version,
          dismissed: changes.update_dismissed
            ? typeof dismissed === "string"
              ? dismissed
              : ""
            : previous.dismissed,
        };
      });
    };
    chrome.storage.onChanged.addListener(changed);
    return () => {
      active = false;
      chrome.storage.onChanged.removeListener(changed);
    };
  }, []);
  const visible = !!notice.version && notice.dismissed !== notice.version;
  useEffect(() => {
    if (visible) chrome.action.setBadgeText({ text: "" }, reportRuntimeError);
  }, [visible, notice.version]);
  const isRu =
    language.startsWith("ru") ||
    ((!language || language === "auto") &&
      chrome.i18n.getUILanguage().startsWith("ru"));
  const close = () => {
    setNotice((previous) => ({ ...previous, dismissed: previous.version }));
    chrome.storage.sync.set(
      { update_dismissed: notice.version },
      reportRuntimeError,
    );
  };
  return (
    <div
      {...(id ? { id } : {})}
      className="update-banner"
      hidden={!visible}
      style={visible ? { display: "block" } : undefined}
    >
      {visible && (
        <>
          <button
            type="button"
            className="update-close"
            aria-label={t("cherryPickClose")}
            onClick={close}
          >
            ×
          </button>
          <strong className="update-version">v{notice.version}</strong>
          <p>{t("updateBannerText")}</p>
          <a
            href={
              CHANGELOG_BASE_URL + (isRu ? "CHANGELOG_RU.md" : "CHANGELOG.md")
            }
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("updateChangelog")}
          </a>
          <p className="update-review">
            {t("updateReviewAsk")}{" "}
            <a
              href={STORE_REVIEWS_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("updateReviewLink")}
            </a>
          </p>
        </>
      )}
    </div>
  );
}
