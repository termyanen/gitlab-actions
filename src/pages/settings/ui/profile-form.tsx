import { CherryPickOptions } from "./cherry-pick-options";
import { DefaultForm, defaultSections } from "./default-form";
import { Field } from "./field";
import {
  MR_DEFAULTS,
  VERSION_DEFAULTS,
  normalizeCherryPickBranches,
} from "../../../entities/settings";
import type { Settings } from "../../../features/manage-settings";
import type { SectionMeta } from "../model/navigation";
import {
  useSettingsForm,
  SettingInheritance,
  BoundInput,
  BoundToggle,
  BoundSelect,
  Section,
  plainVersionFile,
} from "./form-controls";
import {
  ButtonOrder,
  CustomJobsEditor,
  MrActionsEditor,
  CherryPickEditor,
} from "./editors";
export const profileSections: readonly SectionMeta[] = [
  { category: "actions", terms: ["buttonsFor", "overrideHint"] },
  {
    category: "actions",
    terms: [
      "versionBump",
      "filePath",
      "versionField",
      "strategy",
      "commitMessage",
    ],
  },
  { category: "actions", terms: ["reviewers", "reviewersList", "jobName"] },
  { category: "ci", terms: ["customJobButtons", "projectSpecificJobs"] },
  { category: "actions", terms: ["mrActions", "mrActionsProfileHint"] },
  {
    category: "actions",
    terms: [
      "cherryPickBranches",
      "cherryPickProjectBranchesHint",
      "showCherryPick",
      "cherryPickCreateMrDefault",
      "cherryPickSmartFallback",
      "cherryPickBumpVersion",
      "addCherryPickBranch",
    ],
  },
];
export const allProfileSections = [...profileSections, ...defaultSections];
export function ProfileForm({
  scope,
  data,
}: {
  scope: string;
  data: Settings;
}) {
  const { draft, update, t } = useSettingsForm();
  const editorProps = { draft, update, t, profile: true };
  const projectBranches = normalizeCherryPickBranches(draft.branches);
  const effectiveBranches = projectBranches.length
    ? projectBranches
    : normalizeCherryPickBranches(data.cherry_pick_branches);
  const textFields = [
    [
      "profileVersionPath",
      "versionField",
      data.versionPath || VERSION_DEFAULTS.versionPath,
      "versionFieldHint",
    ],
    [
      "profileVersionCommitTemplate",
      "commitMessage",
      data.versionCommitTemplate || VERSION_DEFAULTS.versionCommitTemplate,
      "commitMessageHint",
    ],
  ] as const;
  return (
    <>
      <p className="hint">{t("settingsProjectInheritanceHint")}</p>
      <Section meta={profileSections[0]}>
        <h2>{t("buttonsFor", [scope.split("/").pop() || scope])}</h2>
        <p className="hint">{t("overrideHint")}</p>
        <SettingInheritance settingKey="buttonOrder">
          <ButtonOrder {...editorProps} />
        </SettingInheritance>
      </Section>
      <Section meta={profileSections[5]}>
        <h2>{t("cherryPickBranches")}</h2>
        <p className="hint">{t("cherryPickProjectBranchesHint")}</p>
        <CherryPickOptions />
        <CherryPickEditor {...editorProps} />
        <p className="hint" id="cherryPickBranchesSource">
          {t(projectBranches.length ? "cherryPickBranches" : "settingsGlobal")}:{" "}
          {effectiveBranches.length
            ? effectiveBranches.join(", ")
            : t("cherryPickNoBranches")}
        </p>
      </Section>
      <Section meta={profileSections[1]}>
        <h2>{t("versionBump")}</h2>
        <BoundToggle id="show_commit_version" label={t("showCommitVersion")} />
        <BoundToggle id="version_from_target" label={t("versionFromTarget")} />
        <p className="hint">{t("leaveEmptyDefault")}</p>
        <Field label={t("filePath")} htmlFor="profileVersionFilePreset">
          <BoundSelect id="profileVersionFilePreset">
            <option value="">
              ({t("default")}) —{" "}
              {data.versionFile || VERSION_DEFAULTS.versionFile}
            </option>
            <option value="package.json">package.json</option>
            <option value="pyproject.toml">pyproject.toml</option>
            <option value="__custom__">{t("customFile")}</option>
          </BoundSelect>
          <BoundInput
            id="profileVersionFile"
            aria-label={t("filePath")}
            placeholder="path/to/file"
            hidden={draft.fields.versionFilePreset !== "__custom__"}
          />
        </Field>
        {textFields.slice(0, 1).map(([id, label, placeholder, hint]) => (
          <div
            key={id}
            id="profileVersionPathField"
            hidden={plainVersionFile(draft, true)}
          >
            <Field label={t(label)} htmlFor={id} hint={t(hint)}>
              <BoundInput id={id} placeholder={placeholder} />
            </Field>
          </div>
        ))}
        <Field htmlFor="profileVersionStrategy" label={t("strategy")}>
          <BoundSelect id="profileVersionStrategy">
            <option value="">
              ({t("default")}) —{" "}
              {t(
                data.versionStrategy === "major"
                  ? "strategyMajor"
                  : data.versionStrategy === "minor"
                    ? "strategyMinor"
                    : "strategyPatch",
              )}
            </option>
            <option value="patch">{t("strategyPatch")}</option>
            <option value="minor">{t("strategyMinor")}</option>
            <option value="major">{t("strategyMajor")}</option>
          </BoundSelect>
        </Field>
        {textFields.slice(1).map(([id, label, placeholder, hint]) => (
          <Field key={id} label={t(label)} htmlFor={id} hint={t(hint)}>
            <BoundInput id={id} placeholder={placeholder} />
          </Field>
        ))}
      </Section>
      <Section meta={profileSections[2]}>
        <h2>{t("reviewers")}</h2>
        <Field
          label={t("reviewersList")}
          htmlFor="profileReviewersList"
          hint={t("reviewersListHint")}
        >
          <BoundInput
            id="profileReviewersList"
            placeholder={data.reviewersList || t("leaveEmptyDefault")}
          />
        </Field>
        <Field
          label={t("jobName")}
          htmlFor="profileReviewersJob"
          hint={t("leaveEmptyDefault")}
        >
          <BoundInput
            id="profileReviewersJob"
            placeholder={data.reviewersJob || MR_DEFAULTS.reviewersJob}
          />
        </Field>
      </Section>
      <Section meta={profileSections[3]}>
        <h2>{t("customJobButtons")}</h2>
        <p className="hint">{t("projectSpecificJobs")}</p>
        <SettingInheritance settingKey="customJobs">
          <CustomJobsEditor {...editorProps} />
        </SettingInheritance>
      </Section>
      <Section meta={profileSections[4]}>
        <h2>{t("mrActions")}</h2>
        <p className="hint">{t("mrActionsHint")}</p>
        <p className="hint">{t("mrActionsProfileHint")}</p>
        <SettingInheritance settingKey="mrActions">
          <MrActionsEditor {...editorProps} />
        </SettingInheritance>
      </Section>
      <DefaultForm additionalProfile />
    </>
  );
}
