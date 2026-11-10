import type { ComponentProps, ReactNode } from "react";

export type SettingsIcon =
  | "actions"
  | "ci"
  | "jira"
  | "ai"
  | "appearance"
  | "general"
  | "data"
  | "external"
  | "search"
  | "reset";
const paths: Record<SettingsIcon, string> = {
  actions:
    "M4 5v6M12 11V8c0-3-8-2-8-5M6 3a2 2 0 1 1-4 0 2 2 0 0 1 4 0M6 13a2 2 0 1 1-4 0 2 2 0 0 1 4 0M14 13a2 2 0 1 1-4 0 2 2 0 0 1 4 0",
  ci: "M5 8h6M5 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0M15 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0",
  jira: "m8 1 7 7-7 7-7-7Z",
  ai: "m8 1 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z",
  appearance: "M1 2h14v10H1zM5 15h6M8 12v3M1 5h14",
  general: "M2 4h12M2 12h12M5 2v4M11 10v4",
  data: "M2 3h12v11H2zM2 6h12M6 9h4",
  external: "M9 2h5v5M14 2 7 9M6 3H2v11h11v-4",
  reset: "M3 6a5 5 0 1 1 0 5M3 2v4h4",
  search: "M11 11l4 4M12 7a5 5 0 1 1-10 0 5 5 0 0 1 10 0",
};

export function Icon({ name }: { name: SettingsIcon }) {
  return (
    <svg viewBox="0 0 16 16" className="settings-icon" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}

export function SettingsBrand() {
  return (
    <div className="settings-brand">
      <span className="brand-mark">
        <Icon name="actions" />
      </span>
      <strong>GitLab MR Actions</strong>
    </div>
  );
}

export function SettingsButton({
  icon,
  children,
  className = "",
  type = "button",
  ...props
}: ComponentProps<"button"> & { icon?: SettingsIcon }) {
  return (
    <button
      {...props}
      aria-label={
        props["aria-label"] ??
        (typeof children === "string" ? children : undefined)
      }
      type={type}
      className={`settings-button ${className}`.trim()}
    >
      {icon && <Icon name={icon} />}
      <span>{children}</span>
    </button>
  );
}

type ToggleProps = Omit<
  ComponentProps<"input">,
  "onChange" | "type" | "id" | "checked" | "children"
> & {
  id: string;
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
};
export function Toggle({
  id,
  label,
  checked,
  onChange,
  ...props
}: ToggleProps) {
  return (
    <div className="toggle">
      <input
        {...props}
        type="checkbox"
        id={id}
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}

export function SaveStatus({
  message,
  kind = "",
  className = "status",
  id,
  children,
}: {
  message: string;
  kind?: "ready" | "unsaved" | "saved" | "failed" | "";
  className?: string;
  id?: string;
  children?: ReactNode;
}) {
  return (
    <div
      {...(id ? { id } : {})}
      className={`${className} ${kind}`.trim()}
      role="status"
      aria-live="polite"
    >
      {message}
      {children}
    </div>
  );
}
