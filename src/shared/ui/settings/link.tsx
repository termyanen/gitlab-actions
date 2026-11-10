import type { ComponentProps } from "react";
import { Icon } from "./components";
import type { SettingsIcon } from "./components";

export function SettingsLink({
  icon,
  children,
  className = "",
  ...props
}: ComponentProps<"a"> & { icon?: SettingsIcon }) {
  return (
    <a {...props} className={`settings-button ${className}`.trim()}>
      {icon && <Icon name={icon} />}
      <span>{children}</span>
    </a>
  );
}
