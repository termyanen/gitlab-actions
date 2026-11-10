import { useState } from "react";
import type { ReactNode } from "react";

/** Local presentation preference, separate from exported/project settings. */
export function PopupDisclosure({
  name,
  title,
  className = "",
  children,
}: {
  name: "jira" | "scope";
  title: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const key = `popup.disclosure.${name}`;
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(key) !== "closed";
    } catch {
      // The controls remain usable if local preference storage is unavailable.
      return true;
    }
  });
  return (
    <details
      className={`popup-disclosure ${className}`}
      data-popup-disclosure={name}
      open={open}
    >
      <summary
        onClick={(event) => {
          event.preventDefault();
          const expanded = !open;
          setOpen(expanded);
          try {
            localStorage.setItem(key, expanded ? "open" : "closed");
          } catch {
            // Only persistence is optional; collapsing still works in this window.
          }
        }}
      >
        {title}
      </summary>
      {children}
    </details>
  );
}
