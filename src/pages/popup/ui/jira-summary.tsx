import { useEffect, useState } from "react";
import { JiraConnectionCheck } from "../../../features/check-jira-connection";
import type { UiTranslate } from "../../../shared/lib/ui-language";

export default function JiraAccessSummary({
  origin,
  url,
  t,
  onReady,
}: {
  origin: string;
  url: string;
  t: UiTranslate;
  onReady: (origin: string) => void;
}) {
  const [result, setResult] = useState<{
    origin: string;
    granted: boolean;
  } | null>(null);
  useEffect(() => {
    let active = true;
    const check = () => {
      chrome.permissions.contains({ origins: [origin + "/*"] }, (granted) => {
        const failed = !!chrome.runtime.lastError;
        if (active) {
          setResult({ origin, granted: !failed && granted });
          onReady(origin);
        }
      });
    };
    check();
    chrome.permissions.onAdded.addListener(check);
    chrome.permissions.onRemoved.addListener(check);
    return () => {
      active = false;
      chrome.permissions.onAdded.removeListener(check);
      chrome.permissions.onRemoved.removeListener(check);
    };
  }, [origin, onReady]);
  return (
    <div className="hint jira-access-summary">
      <p role="status">
        {result?.origin === origin
          ? t(result.granted ? "jiraAccessGranted" : "jiraErrorPermission", [
              new URL(origin).host,
            ])
          : ""}{" "}
        <a href={url} target="_blank" rel="noopener noreferrer">
          {t("jiraOpenSite")}
        </a>
      </p>
      <JiraConnectionCheck
        url={url}
        allowed={result?.origin === origin && result.granted}
        t={t}
      />
    </div>
  );
}
