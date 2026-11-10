import { categories } from "../../../shared/config/settings-navigation";
import type { Category } from "../../../shared/config/settings-navigation";
export interface SectionMeta {
  category: Category;
  terms: readonly string[];
}
export function readCategory(value: string | null): Category {
  return categories.find(([id]) => id === value)?.[0] || "actions";
}
export function effectiveScope(
  scope: string,
  category: Category,
  search: string,
) {
  return category === "data" && !search.trim() ? "default" : scope;
}
export function matchesSection(
  meta: SectionMeta | undefined,
  category: Category,
  search: string,
  t: (key: string) => string,
) {
  if (!meta) return false;
  if (!search.trim()) return meta.category === category;
  const label = categories.find(([id]) => id === meta.category)?.[1] || "";
  return [...meta.terms, label]
    .map((k) => t(k))
    .join(" ")
    .toLocaleLowerCase()
    .includes(search.trim().toLocaleLowerCase());
}
