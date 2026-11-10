import {
  LEGACY_PROJECT_FIELDS,
  isProjectSettingKey,
} from "../../../shared/config/project-settings";
import { createContext, useContext } from "react";
import type { ComponentProps, ReactNode } from "react";
import { Toggle, SettingsButton } from "../../../shared/ui/settings";
import { LANGUAGES } from "../../../shared/i18n";
import { DISPLAY_NUMBER_LIMITS } from "../../../entities/settings";
import {
  fieldText,
  projectFieldKey,
  inheritProjectSetting,
} from "../model/draft";
import type { SettingsDraft, Translate } from "../model/draft";
import { matchesSection } from "../model/navigation";
import type { SectionMeta } from "../model/navigation";
import type { Category } from "../../../shared/config/settings-navigation";
interface FormContext {
  draft: SettingsDraft;
  update: (draft: SettingsDraft) => void;
  t: Translate;
  category: Category;
  search: string;
  profile: boolean;
}
export const SettingsFormContext = createContext<FormContext | null>(null);
export function useSettingsForm() {
  const value = useContext(SettingsFormContext);
  if (!value) throw new Error("Settings form context missing");
  return value;
}
function fieldName(id: string) {
  return id.startsWith("profile")
    ? id.charAt(7).toLowerCase() + id.slice(8)
    : id;
}
function useField(id: string) {
  const ctx = useSettingsForm();
  const key = fieldName(id);
  return {
    ...ctx,
    key,
    value: fieldText(ctx.draft, key),
    change: (value: string | boolean) =>
      ctx.update({
        ...ctx.draft,
        fields: { ...ctx.draft.fields, [key]: value },
      }),
  };
}
export function BoundInput({
  id,
  ...props
}: ComponentProps<"input"> & { id: string }) {
  const { value, change, key } = useField(id);
  const limits = Object.entries(DISPLAY_NUMBER_LIMITS).find(
    ([name]) => name === key,
  )?.[1];
  return (
    <SettingInheritance settingKey={props.hidden ? "" : fieldName(id)}>
      <input
        {...props}
        id={id}
        value={value}
        onChange={(e) => change(e.currentTarget.value)}
        {...(limits ? { min: limits.min, max: limits.max, step: 1 } : {})}
      />
    </SettingInheritance>
  );
}
export function BoundTextarea({
  id,
  ...props
}: ComponentProps<"textarea"> & { id: string }) {
  const { value, change } = useField(id);
  return (
    <SettingInheritance settingKey={fieldName(id)}>
      <textarea
        {...props}
        id={id}
        value={value}
        onChange={(e) => change(e.currentTarget.value)}
      />
    </SettingInheritance>
  );
}
export function BoundSelect({
  id,
  ...props
}: ComponentProps<"select"> & { id: string }) {
  const { value, change, key, draft, update } = useField(id);
  return (
    <SettingInheritance settingKey={fieldName(id)}>
      <select
        {...props}
        id={id}
        value={value}
        onChange={(e) => {
          const value = e.currentTarget.value;
          if (key === "versionFilePreset")
            update({
              ...draft,
              fields: { ...draft.fields, [key]: value, versionFile: "" },
            });
          else change(value);
        }}
      />
    </SettingInheritance>
  );
}
export function BoundToggle({ id, label }: { id: string; label: string }) {
  const { draft, key, change } = useField(id);
  return (
    <SettingInheritance settingKey={fieldName(id)}>
      <Toggle
        id={id}
        label={label}
        checked={draft.fields[key] === true}
        onChange={change}
      />
    </SettingInheritance>
  );
}
export function LanguageOptions({
  automaticLabel,
}: {
  automaticLabel: string;
}) {
  return (
    <>
      <option value="auto">{automaticLabel}</option>
      {LANGUAGES.map(({ code, label }) => (
        <option key={code} value={code}>
          {label}
        </option>
      ))}
    </>
  );
}
export function plainVersionFile(draft: SettingsDraft, profile: boolean) {
  const preset = fieldText(draft, "versionFilePreset");
  const file =
    preset === (profile ? "__custom__" : "custom")
      ? fieldText(draft, "versionFile")
      : preset;
  return /(?:\.txt|\.text|VERSION)$/i.test(file);
}
export function Section({
  meta,
  children,
}: {
  meta: SectionMeta | undefined;
  children: ReactNode;
}) {
  const { category, search, t } = useSettingsForm();
  return (
    <section
      className="settings-section"
      data-category={meta?.category}
      hidden={!matchesSection(meta, category, search, t)}
    >
      {children}
    </section>
  );
}

export function SettingInheritance({
  settingKey,
  children,
}: {
  settingKey: string;
  children: ReactNode;
}) {
  const { draft, update, t, profile } = useSettingsForm();
  const key = projectFieldKey(settingKey);
  const legacyKey = key === "versionFilePreset" ? "versionFile" : key;
  const legacy = LEGACY_PROJECT_FIELDS.some((field) => field === legacyKey);
  if (!profile || (!isProjectSettingKey(key) && !legacy)) return children;
  const preset = fieldText(draft, "versionFilePreset");
  const legacyValue =
    legacyKey === "versionFile"
      ? ["custom", "__custom__"].includes(preset)
        ? fieldText(draft, "versionFile")
        : preset
      : draft.fields[legacyKey];
  const own = legacy
    ? draft.legacyKeys?.includes(legacyKey) === true &&
      (typeof legacyValue !== "string" || !!legacyValue.trim())
    : draft.overrides?.includes(key) === true;
  return (
    <div className="setting-inheritance" data-setting={key}>
      {children}
      <div className="setting-inheritance-status">
        <span>{t(own ? "settingsProjectValue" : "settingsGlobal")}</span>
        {own && (
          <SettingsButton
            className="inherit-reset"
            icon="reset"
            title={t("settingsUseGlobal")}
            onClick={() => update(inheritProjectSetting(draft, legacyKey))}
          >
            {t("settingsUseGlobal")}
          </SettingsButton>
        )}
      </div>
    </div>
  );
}
