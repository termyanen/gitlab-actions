import { JiraConnectionCheck } from "../../../features/check-jira-connection";
import { Field } from "./field";
import { useEffect, useRef, useState } from "react";
import { readJiraBaseUrl } from "../../../shared/config/jira";
import { SettingsButton, SettingsLink } from "../../../shared/ui/settings";
import { useSettingsForm, BoundInput } from "./form-controls";
import { fieldText } from "../model/draft";
export function JiraConnection() {
  const { draft, t } = useSettingsForm();
  const value = fieldText(draft, "jira_url");
  const site = readJiraBaseUrl(value);
  const [status, setStatus] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [checkVersion, setCheckVersion] = useState(0);
  const current = useRef(value);
  const active = useRef(false);
  const permissionRevision = useRef(0);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    current.current = value;
    const revision = ++permissionRevision.current;
    let valid = true;
    const jira = readJiraBaseUrl(value);
    if (!value.trim()) {
      setStatus("");
      return;
    }
    if (!jira) {
      setStatus("jiraUrlInvalid");
      return;
    }
    setStatus("");
    chrome.permissions.contains(
      { origins: [jira.origin + "/*"] },
      (granted) => {
        const failed = !!chrome.runtime.lastError;
        if (valid && revision === permissionRevision.current)
          setStatus(
            !failed && granted ? "jiraAccessGranted" : "jiraErrorPermission",
          );
      },
    );
    return () => {
      valid = false;
    };
  }, [value, checkVersion]);
  useEffect(() => {
    const changed = () => setCheckVersion((v) => v + 1);
    chrome.permissions.onAdded?.addListener(changed);
    chrome.permissions.onRemoved?.addListener(changed);
    return () => {
      chrome.permissions.onAdded?.removeListener(changed);
      chrome.permissions.onRemoved?.removeListener(changed);
    };
  }, []);
  const grant = () => {
    if (requesting) return;
    const jira = readJiraBaseUrl(value);
    if (!jira) {
      setStatus("jiraUrlInvalid");
      return;
    }
    setRequesting(true);
    setStatus("");
    // Invalidate checks started before this explicit permission request.
    permissionRevision.current++;
    chrome.permissions.request({ origins: [jira.origin + "/*"] }, (granted) => {
      const failed = !!chrome.runtime.lastError;
      if (!active.current) return;
      // A focus check can also start while the browser permission prompt is
      // pending. Its earlier result must not replace the grant/denial reply.
      permissionRevision.current++;
      setRequesting(false);
      if (current.current === value)
        setStatus(
          !failed && granted ? "jiraAccessGranted" : "jiraErrorPermission",
        );
      else setCheckVersion((v) => v + 1);
    });
  };
  return (
    <Field htmlFor="jira_url" label={t("jiraUrl")}>
      <BoundInput
        id="jira_url"
        placeholder="https://jira.company.com"
        aria-describedby="jiraAccessStatus"
        onFocus={() => setCheckVersion((v) => v + 1)}
      />
      <div className="hint">{t("jiraUrlHint")}</div>
      <div className="jira-connection-actions">
        <SettingsButton
          id="jiraGrantAccess"
          className="add-btn"
          disabled={requesting}
          onClick={grant}
        >
          {t("jiraGrantAccess")}
        </SettingsButton>
        {site && (
          <SettingsLink
            href={site.url}
            target="_blank"
            rel="noopener noreferrer"
            icon="external"
            className="add-btn"
          >
            {t("jiraOpenSite")}
          </SettingsLink>
        )}
      </div>
      <div
        className="hint"
        id="jiraAccessStatus"
        role="status"
        aria-live="polite"
      >
        {status ? t(status, site ? [new URL(site.url).host] : []) : ""}
      </div>
      {site && (
        <JiraConnectionCheck
          url={site.url}
          allowed={status === "jiraAccessGranted"}
          t={t}
        />
      )}
    </Field>
  );
}
