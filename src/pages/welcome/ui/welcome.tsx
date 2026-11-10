import { useEffect } from "react";
import {
  REVIEW_GUIDE_URL,
  SETTINGS_PAGE,
} from "../../../shared/config/extension";
import { mountReactPage } from "../../../shared/lib/react-page";
import { useUiLanguage } from "../../../shared/lib/ui-language";
import type { UiTranslate } from "../../../shared/lib/ui-language";
import {
  SettingsBrand,
  SettingsButton,
  SettingsLink,
  SaveStatus,
} from "../../../shared/ui/settings";
import { featureSections } from "../model/content";
import { useWelcomeLanguage } from "../model/use-welcome-language";

const quickSteps = [1, 2, 3] as const;
const sessionNotes = [1, 2, 3, 4] as const;
const navigation = [
  "welcomeQuickStart",
  "welcomeEnabledDefault",
  "aiReviewFeatureTitle",
  "welcomeMoreActions",
  "welcomeMrListFeatures",
  "uiCustomization",
  "welcomeHowItWorks",
] as const;

function FeatureSection({
  section,
  t,
}: {
  section: (typeof featureSections)[number];
  t: UiTranslate;
}) {
  return (
    <section className="welcome-section" aria-labelledby={section.title}>
      <h2 id={section.title} data-i18n={section.title}>
        {t(section.title)}
      </h2>
      <div className="welcome-grid">
        {section.cards.map(([title, description]) => (
          <article className="welcome-card" key={title}>
            <h3 data-i18n={title}>{t(title)}</h3>
            <p data-i18n={description}>{t(description)}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function ReviewGuide({ t }: { t: UiTranslate }) {
  return (
    <section
      className="welcome-section welcome-highlight"
      aria-labelledby="aiReviewFeatureTitle"
    >
      <h2 id="aiReviewFeatureTitle" data-i18n="aiReviewFeatureTitle">
        {t("aiReviewFeatureTitle")}
      </h2>
      <p data-i18n="aiReviewFeatureDesc">{t("aiReviewFeatureDesc")}</p>
      <p data-i18n="aiReviewPrivacyHint">{t("aiReviewPrivacyHint")}</p>
      <a href={REVIEW_GUIDE_URL} target="_blank" rel="noopener noreferrer">
        <span data-i18n="aiReviewGuide">{t("aiReviewGuide")}</span> (EN / RU){" "}
        <span aria-hidden="true">↗</span>
      </a>
    </section>
  );
}

export function WelcomePage() {
  const preference = useWelcomeLanguage();
  const { t, loading } = useUiLanguage(preference.language);
  const ready = preference.loaded && !loading;
  useEffect(() => {
    document.title = t("welcomeTitle");
  }, [t]);
  return (
    <div className="settings-shell welcome-shell" aria-busy={!ready}>
      <aside className="settings-sidebar welcome-sidebar">
        <SettingsBrand />
        <nav aria-label={t("welcomeTitle")}>
          {navigation.map((key) => (
            <a key={key} href={`#${key}`}>
              {t(key)}
            </a>
          ))}
        </nav>
      </aside>
      <main className="welcome-main" id="welcomeContent">
        {preference.failed && (
          <div className="welcome-load-error">
            <SaveStatus kind="failed" message={t("settingsLoadFailed")} />
            <SettingsButton onClick={preference.retry}>
              {t("aiReviewRetry")}
            </SettingsButton>
          </div>
        )}
        {ready && (
          <>
            <header className="welcome-hero">
              <h1 data-i18n="welcomeTitle">{t("welcomeTitle")}</h1>
              <p data-i18n="welcomeSubtitle">{t("welcomeSubtitle")}</p>
              <SettingsLink
                icon="general"
                className="primary"
                href={SETTINGS_PAGE}
                target="_blank"
                rel="noopener"
                data-i18n="welcomeOpenSettings"
              >
                {t("welcomeOpenSettings")}
              </SettingsLink>
            </header>
            <section
              className="welcome-section"
              aria-labelledby="welcomeQuickStart"
            >
              <h2 id="welcomeQuickStart" data-i18n="welcomeQuickStart">
                {t("welcomeQuickStart")}
              </h2>
              <ol className="welcome-steps">
                {quickSteps.map((step) => (
                  <li key={step}>
                    <h3 data-i18n={`welcomeStep${step}Title`}>
                      {t(`welcomeStep${step}Title`)}
                    </h3>
                    <p data-i18n={`welcomeStep${step}Desc`}>
                      {t(`welcomeStep${step}Desc`)}
                    </p>
                  </li>
                ))}
              </ol>
            </section>
            {featureSections.map((section) => (
              <div key={section.title}>
                <FeatureSection section={section} t={t} />
                {section.title === "welcomeEnabledDefault" && (
                  <ReviewGuide t={t} />
                )}
              </div>
            ))}
            <section
              className="welcome-section welcome-session"
              aria-labelledby="welcomeHowItWorks"
            >
              <h2 id="welcomeHowItWorks" data-i18n="welcomeHowItWorks">
                {t("welcomeHowItWorks")}
              </h2>
              <p data-i18n="welcomeHowDesc">{t("welcomeHowDesc")}</p>
              <ul>
                {sessionNotes.map((note) => (
                  <li key={note} data-i18n={`welcomeHowList${note}`}>
                    {t(`welcomeHowList${note}`)}
                  </li>
                ))}
              </ul>
            </section>
            <footer className="welcome-footer">
              <p className="welcome-tip" data-i18n="welcomeTip">
                {t("welcomeTip")}
              </p>
              <SettingsLink
                icon="general"
                className="primary"
                href={SETTINGS_PAGE}
                target="_blank"
                rel="noopener"
                id="openSettings"
                data-i18n="welcomeOpenSettings"
              >
                {t("welcomeOpenSettings")}
              </SettingsLink>
            </footer>
          </>
        )}
      </main>
    </div>
  );
}

export function startWelcome() {
  mountReactPage(<WelcomePage />, "welcomeRoot");
}
