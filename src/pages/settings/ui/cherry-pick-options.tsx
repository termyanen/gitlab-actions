import { BoundToggle, useSettingsForm } from "./form-controls";
export function CherryPickOptions() {
  const { t } = useSettingsForm();
  return (
    <>
      <BoundToggle
        id="cherry_pick_target_version"
        label={t("cherryPickTargetVersion")}
      />
      <div className="hint">{t("cherryPickTargetVersionHint")}</div>
      <BoundToggle id="show_cherry_pick" label={t("showCherryPick")} />
      <BoundToggle
        id="cherry_pick_create_mr"
        label={t("cherryPickCreateMrDefault")}
      />
      <BoundToggle
        id="cherry_pick_smart_fallback"
        label={t("cherryPickSmartFallback")}
      />
      <div className="hint" style={{ marginBottom: "8px" }}>
        {t("cherryPickSmartFallbackHint")}
      </div>
      <BoundToggle
        id="cherry_pick_bump_version"
        label={t("cherryPickBumpVersion")}
      />
      <div className="hint" style={{ marginBottom: "8px" }}>
        {t("cherryPickBumpVersionHint")}
      </div>
    </>
  );
}
