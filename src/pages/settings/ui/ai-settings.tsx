import { Field } from "./field";
import {
  AI_REVIEW_PROMPTS,
  AI_REVIEW_RULES,
  AI_REVIEW_FILTER_FIELDS,
  AI_REVIEW_FILTER_LABELS,
  AI_REVIEW_PROMPT_MAX_LENGTH,
} from "../../../features/manage-settings";
import { INSTRUCTION_PREFIX } from "../../../entities/review";
import { REVIEW_GUIDE_URL } from "../../../shared/config/extension";
import { SettingsButton } from "../../../shared/ui/settings";
import { resetDraftField } from "../model/draft";
import {
  useSettingsForm,
  BoundToggle,
  BoundTextarea,
  BoundSelect,
  LanguageOptions,
} from "./form-controls";
export function AiSettings() {
  const { draft, update, t, search } = useSettingsForm();
  return (
    <>
      <h2>{t("aiReviewSettingsTitle")}</h2>
      <BoundToggle id="show_ai_review_copy" label={t("showAiReviewCopy")} />
      <p className="hint">{t("aiReviewSettingsHint")}</p>
      <BoundToggle
        id="ai_review_confirm_close"
        label={t("aiReviewConfirmCloseSetting")}
      />
      <BoundToggle
        id="ai_review_expand_comments"
        label={t("aiReviewExpandCommentsSetting")}
      />
      <p className="hint">{t("aiReviewPrivacyHint")}</p>
      <p>
        <a
          className="how-link review-guide-link"
          href={REVIEW_GUIDE_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("aiReviewGuide")} (EN / RU)
        </a>
      </p>
      <Field
        htmlFor="ai_review_response_language"
        label={t("aiReviewResponseLanguage")}
        hint={t("aiReviewResponseLanguageHint")}
      >
        <BoundSelect id="ai_review_response_language">
          <LanguageOptions automaticLabel={t("aiReviewResponseLanguageAuto")} />
        </BoundSelect>
      </Field>
      {AI_REVIEW_PROMPTS.map((prompt) => (
        <Field key={prompt.key} htmlFor={prompt.key} label={t(prompt.label)}>
          <BoundTextarea
            id={prompt.key}
            rows={8}
            maxLength={AI_REVIEW_PROMPT_MAX_LENGTH}
            placeholder={prompt.value}
            aria-describedby={prompt.key + "_hint"}
          />
          <div className="hint" id={prompt.key + "_hint"}>
            {t(prompt.hint)}
          </div>
          <SettingsButton
            className="add-btn"
            id={prompt.reset}
            onClick={() => update(resetDraftField(draft, prompt.reset))}
          >
            {t("aiReviewResetPrompt")}
          </SettingsButton>
        </Field>
      ))}
      <details className="ai-review-rules" open={search ? true : undefined}>
        <summary>{t("aiReviewAutomaticInstructions")}</summary>
        <p className="hint">{t("aiReviewAutomaticInstructionsHint")}</p>
        {AI_REVIEW_RULES.map((block) => {
          const key = INSTRUCTION_PREFIX + block.id;
          return (
            <details
              className="ai-review-rule"
              key={key}
              open={search ? true : undefined}
            >
              <summary>{t("aiReviewRule_" + block.id)}</summary>
              <BoundToggle
                id={key + "_enabled"}
                label={t("aiReviewInstructionEnabled")}
              />
              <Field htmlFor={key} label={t("aiReviewRule_" + block.id)}>
                <BoundTextarea
                  id={key}
                  rows={8}
                  maxLength={AI_REVIEW_PROMPT_MAX_LENGTH}
                  placeholder={block.text}
                  aria-describedby={key + "_hint"}
                />
                <div id={key + "_hint"} className="hint">
                  {t(
                    block.id === "language"
                      ? "aiReviewLanguageTemplateHint"
                      : block.id === "reply_task"
                        ? "aiReviewSelectionTemplateHint"
                        : "aiReviewInstructionTextHint",
                  )}
                </div>
                <SettingsButton
                  className="add-btn"
                  id={key + "_reset"}
                  onClick={() => update(resetDraftField(draft, key + "_reset"))}
                >
                  {t("aiReviewResetPrompt")}
                </SettingsButton>
              </Field>
            </details>
          );
        })}
      </details>
    </>
  );
}
export function AiFilters() {
  const { t } = useSettingsForm();
  return (
    <>
      <h2>{t("aiReviewFileFilters")}</h2>
      <p className="hint">{t("aiReviewFileFiltersHint")}</p>
      {AI_REVIEW_FILTER_FIELDS.map((key) => (
        <Field
          key={key}
          htmlFor={"ai_review_filter_" + key}
          label={t(AI_REVIEW_FILTER_LABELS[key])}
        >
          <BoundTextarea
            id={"ai_review_filter_" + key}
            rows={3}
            maxLength={AI_REVIEW_PROMPT_MAX_LENGTH}
          />
        </Field>
      ))}
    </>
  );
}
