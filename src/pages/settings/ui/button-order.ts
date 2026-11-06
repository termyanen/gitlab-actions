import type { CustomJob, MrAction } from "../../../entities/settings";
import { BUILTIN_BUTTONS } from "../../../features/manage-settings";
import type { ButtonItem } from "../model/types";
import { byId } from "./dom";
export function createButtonOrderEditor(
  t: (key: string, substitutions?: string[]) => string,
  scheduleAutoSave: () => void,
) {
  function buildOrderedList(
    savedOrder: string[],
    enabledMap: Record<string, boolean>,
    customJobs: CustomJob[],
    mrActions: MrAction[],
  ) {
    const allKeys: string[] = [];
    BUILTIN_BUTTONS.forEach(function (b) {
      allKeys.push(b.key);
    });
    (customJobs || []).forEach(function (_job, i) {
      allKeys.push("custom_" + i);
    });

    (mrActions || []).forEach(function (a) {
      allKeys.push("mr_action_" + a.id);
    });
    const ordered: string[] = [];
    (savedOrder || []).forEach(function (key) {
      if (allKeys.indexOf(key) !== -1) ordered.push(key);
    });
    allKeys.forEach(function (key) {
      if (ordered.indexOf(key) === -1) ordered.push(key);
    });

    return ordered
      .map(function (key) {
        if (key.indexOf("mr_action_") === 0) {
          const action = (mrActions || []).find(function (a) {
            return key === "mr_action_" + a.id;
          });
          return {
            key: key,
            label: action!.label || t("mrActions"),
            enabled: true,
            isCustom: true,
          };
        }
        if (key.indexOf("custom_") === 0) {
          const idx = parseInt(key.replace("custom_", ""));
          const cj = customJobs[idx];
          if (!cj) return null;
          return {
            key: key,
            label: cj.label || cj.jobName || "Custom",
            enabled: true,
            isCustom: true,
          };
        }
        const builtin = BUILTIN_BUTTONS.find(function (b) {
          return b.key === key;
        });
        if (!builtin) return null;
        return {
          key: key,
          label: t(builtin.labelKey),
          enabled: enabledMap[key] || false,
          isCustom: false,
        };
      })
      .filter((item): item is ButtonItem => item !== null);
  }

  function renderButtonOrder(items: ButtonItem[], containerId: string) {
    const container = byId(containerId);
    if (!container) return;
    container.innerHTML = "";

    let dragSrcEl: HTMLElement | null = null;

    items.forEach(function (item, i) {
      const row = document.createElement("div");
      row.className = "btn-item";
      row.setAttribute("data-key", item.key);
      row.setAttribute("draggable", "true");

      // Find hint from BUILTIN_BUTTONS
      let hint = "";
      if (!item.isCustom) {
        const def = BUILTIN_BUTTONS.find(function (b) {
          return b.key === item.key;
        });
        if (def && def.hintKey) hint = t(def.hintKey);
      }
      if (hint) row.title = hint;

      // Drag handle
      const handle = document.createElement("span");
      handle.className = "btn-drag-handle";
      handle.innerHTML = "&#9776;";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = item.enabled;
      if (item.isCustom) {
        cb.checked = true;
        cb.disabled = true;
      }

      const lbl = document.createElement("span");
      lbl.className = "btn-label" + (item.isCustom ? " custom-label" : "");
      lbl.textContent = item.label;
      lbl.addEventListener("click", function () {
        if (!cb.disabled) {
          cb.checked = !cb.checked;
          scheduleAutoSave();
        }
      });

      cb.addEventListener("change", function () {
        scheduleAutoSave();
      });

      row.appendChild(handle);
      row.appendChild(cb);
      row.appendChild(lbl);

      // Drag events
      let enterCount = 0;
      row.addEventListener("dragstart", function (e) {
        dragSrcEl = row;
        row.classList.add("dragging");
        e.dataTransfer!.effectAllowed = "move";
        e.dataTransfer!.setData("text/plain", i.toString());
      });
      row.addEventListener("dragend", function () {
        row.classList.remove("dragging");
        container
          .querySelectorAll<HTMLElement>(".btn-item")
          .forEach(function (el) {
            el.classList.remove("drag-over");
          });
      });
      row.addEventListener("dragover", function (e) {
        e.preventDefault();
        e.dataTransfer!.dropEffect = "move";
      });
      row.addEventListener("dragenter", function (e) {
        e.preventDefault();
        enterCount++;
        if (row !== dragSrcEl) row.classList.add("drag-over");
      });
      row.addEventListener("dragleave", function () {
        enterCount--;
        if (enterCount <= 0) {
          row.classList.remove("drag-over");
          enterCount = 0;
        }
      });
      row.addEventListener("drop", function (e) {
        e.preventDefault();
        enterCount = 0;
        row.classList.remove("drag-over");
        if (dragSrcEl === row) return;
        const fromIdx = parseInt(e.dataTransfer!.getData("text/plain"));
        const toIdx = Array.from(container.children).indexOf(row);
        if (fromIdx === toIdx) return;
        const currentItems = getButtonOrderFromUI(containerId);
        const moved = currentItems.splice(fromIdx, 1)[0];
        currentItems.splice(toIdx, 0, moved);
        renderButtonOrder(currentItems, containerId);
        scheduleAutoSave();
      });

      container.appendChild(row);
    });
  }

  function getButtonOrderFromUI(containerId: string) {
    const rows = document.querySelectorAll<HTMLElement>(
      "#" + containerId + " .btn-item",
    );
    const items: ButtonItem[] = [];
    rows.forEach(function (row) {
      items.push({
        key: row.getAttribute("data-key")!,
        label: row.querySelector<HTMLElement>(".btn-label")!.textContent,
        enabled: row.querySelector<HTMLInputElement>('input[type="checkbox"]')!
          .checked,
        isCustom: /^(custom_|mr_action_)/.test(row.getAttribute("data-key")!),
      });
    });
    return items;
  }
  return { buildOrderedList, renderButtonOrder, getButtonOrderFromUI };
}
export type ButtonOrderEditor = ReturnType<typeof createButtonOrderEditor>;
