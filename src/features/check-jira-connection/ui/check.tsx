import { useEffect, useRef, useState } from "react";
import type { UiTranslate } from "../../../shared/lib/ui-language";
import { SettingsButton, SettingsLink } from "../../../shared/ui/settings";
import { probeConnection } from "../model/probe";
import type { ConnectionResult } from "../model/probe";

function Check({ url, t }: { url: string; t: UiTranslate }) {
  const [result, setResult] = useState<ConnectionResult | null>(null);
  const [pending, setPending] = useState(false);
  const [checkedAt, setCheckedAt] = useState<number>();
  const cancel = useRef<(() => void) | undefined>(undefined);
  const busy = useRef(false);
  useEffect(() => () => cancel.current?.(), []);
  const check = () => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setResult(null);
    setCheckedAt(undefined);
    cancel.current = probeConnection(url, (next) => {
      busy.current = false;
      setPending(false);
      setResult(next);
      setCheckedAt(Date.now());
    });
  };
  return (
    <div className="jira-connection-check">
      <p
        className={`hint${result ? (result.ok ? " connection-ok" : " connection-error") : ""}`}
        role="status"
        aria-live="polite"
        aria-busy={pending}
      >
        {t(
          pending
            ? "jiraConnectionChecking"
            : result?.key || "jiraConnectionUnchecked",
          [new URL(url).host],
        )}
        {checkedAt !== undefined && (
          <>
            {" "}
            <time dateTime={new Date(checkedAt).toISOString()}>
              {new Date(checkedAt).toLocaleString(
                document.documentElement.lang,
              )}
            </time>
          </>
        )}
      </p>
      <div className="jira-connection-actions">
        <SettingsButton className="add-btn" onClick={check} disabled={pending}>
          {t("jiraConnectionCheck")}
        </SettingsButton>
        {result?.auth && (
          <SettingsLink
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="add-btn"
            icon="external"
          >
            {t("jiraConnectionSignIn")}
          </SettingsLink>
        )}
      </div>
    </div>
  );
}

/** A changed URL or revoked grant invalidates the last check immediately. */
export function JiraConnectionCheck({
  url,
  allowed,
  t,
}: {
  url: string;
  allowed: boolean;
  t: UiTranslate;
}) {
  return allowed ? <Check key={url} url={url} t={t} /> : null;
}
