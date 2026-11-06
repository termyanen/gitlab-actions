import type {
  BranchState,
  CherryPickSettings,
} from "../../../features/cherry-pick";
import { createCherryPicker } from "../../../features/cherry-pick";
import { errorMessage } from "../../../shared/lib/errors";
import { escHtml } from "../../../shared/lib/html";
import type { Lifecycle } from "../../../shared/lib/lifecycle";
import { createLifecycle } from "../../../shared/lib/lifecycle";
export function createCherryPickDialog(
  origin: string,
  encodedProject: string,
  msg: (key: string) => string,
  showToast: (message: string, type: "success" | "error") => void,
  scope: Lifecycle = createLifecycle(),
) {
  function openCherryPickModal(
    sha: string,
    commitMsg: string,
    settings: CherryPickSettings,
  ) {
    const savedBranches = settings.cherry_pick_branches || [];
    const defaultCreateMr = settings.cherry_pick_create_mr !== false;
    const defaultSmartFallback = settings.cherry_pick_smart_fallback !== false;
    const defaultBumpVersion = settings.cherry_pick_bump_version || false;
    const existing = document.querySelector(".gl-cherry-pick-overlay");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.className = "gl-cherry-pick-overlay";

    const modal = document.createElement("div");
    modal.className = "gl-cherry-pick-modal";

    const shortSha = sha.substring(0, 8);

    modal.innerHTML =
      '<div class="gl-cherry-pick-header">' +
      '<span class="gl-cherry-pick-header-title">' +
      escHtml(msg("cherryPickTitle")) +
      ": " +
      escHtml(shortSha) +
      "</span>" +
      '<button class="gl-cherry-pick-close gl-button btn btn-icon btn-sm btn-default btn-icon-only" type="button" aria-label="Close">' +
      '<svg class="s16 gl-icon gl-button-icon" viewBox="0 0 16 16"><path fill-rule="evenodd" clip-rule="evenodd" d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" fill="currentColor"/></svg>' +
      "</button>" +
      "</div>" +
      '<div class="gl-cherry-pick-commit-msg">' +
      escHtml(commitMsg || sha) +
      "</div>" +
      '<div class="gl-cherry-pick-input-row">' +
      '<input type="text" class="gl-cherry-pick-input gl-form-input form-control" placeholder="' +
      escHtml(msg("cherryPickBranchPlaceholder")) +
      '">' +
      '<button class="gl-button btn btn-default btn-md gl-cherry-pick-add-btn" type="button">' +
      escHtml(msg("cherryPickBranchAdd")) +
      "</button>" +
      "</div>" +
      '<div class="gl-cherry-pick-branches"></div>' +
      '<label class="gl-cherry-pick-mr-toggle gl-form-checkbox">' +
      '<input type="checkbox" class="gl-cherry-pick-mr-checkbox"' +
      (defaultCreateMr ? " checked" : "") +
      ">" +
      "<span>" +
      escHtml(msg("cherryPickCreateMr")) +
      "</span>" +
      "</label>" +
      '<label class="gl-cherry-pick-mr-toggle gl-form-checkbox">' +
      '<input type="checkbox" class="gl-cherry-pick-fallback-checkbox"' +
      (defaultSmartFallback ? " checked" : "") +
      ">" +
      "<span>" +
      escHtml(msg("cherryPickSmartFallback")) +
      "</span>" +
      "</label>" +
      '<label class="gl-cherry-pick-mr-toggle gl-form-checkbox">' +
      '<input type="checkbox" class="gl-cherry-pick-bump-checkbox"' +
      (defaultBumpVersion ? " checked" : "") +
      ">" +
      "<span>" +
      escHtml(msg("cherryPickBumpVersion")) +
      "</span>" +
      "</label>" +
      '<div class="gl-cherry-pick-footer">' +
      '<button class="gl-button btn btn-default btn-md gl-cherry-pick-cancel" type="button">' +
      escHtml(msg("cherryPickClose")) +
      "</button>" +
      '<button class="gl-button btn btn-confirm btn-md gl-cherry-pick-start" type="button">' +
      escHtml(msg("cherryPickStart")) +
      "</button>" +
      "</div>";

    overlay.appendChild(modal);

    const input = modal.querySelector<HTMLInputElement>(
      ".gl-cherry-pick-input",
    )!;
    const addBtn = modal.querySelector<HTMLButtonElement>(
      ".gl-cherry-pick-add-btn",
    )!;
    const branchList = modal.querySelector<HTMLDivElement>(
      ".gl-cherry-pick-branches",
    )!;
    const startBtn = modal.querySelector<HTMLButtonElement>(
      ".gl-cherry-pick-start",
    )!;
    const closeBtn = modal.querySelector<HTMLButtonElement>(
      ".gl-cherry-pick-close",
    )!;
    const cancelBtn = modal.querySelector<HTMLButtonElement>(
      ".gl-cherry-pick-cancel",
    )!;
    const mrCheckbox = modal.querySelector<HTMLInputElement>(
      ".gl-cherry-pick-mr-checkbox",
    )!;
    const fallbackCheckbox = modal.querySelector<HTMLInputElement>(
      ".gl-cherry-pick-fallback-checkbox",
    )!;
    const bumpCheckbox = modal.querySelector<HTMLInputElement>(
      ".gl-cherry-pick-bump-checkbox",
    )!;

    const picker = createCherryPicker(
      origin,
      encodedProject,
      sha,
      settings,
      () => bumpCheckbox.checked,
      msg,
    );
    const branches: BranchState[] = [];

    function addBranch(name: string) {
      name = name.trim();
      if (!name) return;
      for (let i = 0; i < branches.length; i++) {
        if (branches[i].name === name) return;
      }
      branches.push({ name: name, status: "pending", error: "" });
      renderBranches();
    }

    function removeBranch(idx: number) {
      if (branches[idx] && branches[idx].status !== "in_progress") {
        branches.splice(idx, 1);
        renderBranches();
      }
    }

    function renderBranches() {
      branchList.innerHTML = "";
      branches.forEach(function (b, i) {
        const row = document.createElement("div");
        row.className =
          "gl-cherry-pick-branch-row gl-cherry-pick-status-" + b.status;
        let statusIcon = "";
        const _svgPending =
          '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="2" fill="currentColor"/></svg>';
        const _svgProgress =
          '<svg viewBox="0 0 16 16"><path fill="currentColor" fill-rule="evenodd" d="M8 14.5a6.5 6.5 0 100-13 6.5 6.5 0 000 13zM8 16A8 8 0 108 0a8 8 0 000 16z" clip-rule="evenodd"/><path fill="currentColor" d="M8 4a.75.75 0 01.75.75v2.5h2.5a.75.75 0 010 1.5h-3.25A.75.75 0 017.25 8V4.75A.75.75 0 018 4z"/></svg>';
        const _svgSuccess =
          '<svg viewBox="0 0 16 16"><path fill-rule="evenodd" clip-rule="evenodd" d="M0 8a8 8 0 1116 0A8 8 0 010 8zm11.7-1.7a1 1 0 00-1.4-1.42L7 8.17 5.7 6.88a1 1 0 00-1.4 1.42l2 2a1 1 0 001.4 0l4-4z" fill="currentColor"/></svg>';
        const _svgError =
          '<svg viewBox="0 0 16 16"><path fill-rule="evenodd" clip-rule="evenodd" d="M0 8a8 8 0 1116 0A8 8 0 010 8zm5.3-2.3a.75.75 0 00-1.06 1.06L6.44 8 4.24 10.24a.75.75 0 001.06 1.06L7.5 9.06l2.2 2.24a.75.75 0 001.06-1.06L8.56 8l2.2-2.24a.75.75 0 00-1.06-1.06L7.5 6.94 5.3 4.7z" fill="currentColor"/></svg>';
        if (b.status === "pending")
          statusIcon =
            '<span class="gl-cherry-pick-status-icon pending">' +
            _svgPending +
            "</span>";
        else if (b.status === "in_progress")
          statusIcon =
            '<span class="gl-cherry-pick-status-icon in-progress">' +
            _svgProgress +
            "</span>";
        else if (b.status === "success")
          statusIcon =
            '<span class="gl-cherry-pick-status-icon success">' +
            _svgSuccess +
            "</span>";
        else if (b.status === "error")
          statusIcon =
            '<span class="gl-cherry-pick-status-icon error" title="' +
            escHtml(b.error) +
            '">' +
            _svgError +
            "</span>";

        const mrLink =
          b.status === "success" && b.mrUrl
            ? '<a href="' +
              escHtml(b.mrUrl) +
              '" target="_blank" class="gl-cherry-pick-mr-link">MR</a>'
            : "";

        row.innerHTML =
          statusIcon +
          '<span class="gl-cherry-pick-branch-name">' +
          escHtml(b.name) +
          "</span>" +
          (b.status === "error"
            ? '<span class="gl-cherry-pick-error-text">' +
              escHtml(b.error) +
              "</span>"
            : "") +
          mrLink +
          '<button class="gl-cherry-pick-remove" data-idx="' +
          i +
          '" title="' +
          escHtml(msg("cherryPickRemove")) +
          '">&times;</button>';
        branchList.appendChild(row);
      });

      branchList
        .querySelectorAll<HTMLButtonElement>(".gl-cherry-pick-remove")
        .forEach(function (btn) {
          btn.addEventListener("click", function () {
            removeBranch(parseInt(btn.dataset.idx!));
          });
        });
    }

    (savedBranches || []).forEach(function (b) {
      addBranch(b);
    });

    addBtn.addEventListener("click", function () {
      addBranch(input.value);
      input.value = "";
      input.focus();
    });

    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        addBranch(input.value);
        input.value = "";
      }
    });

    let _running = false;

    startBtn.addEventListener("click", function () {
      if (_running) return;
      let hasPending = false;
      for (let k = 0; k < branches.length; k++) {
        if (
          branches[k].status === "pending" ||
          branches[k].status === "error"
        ) {
          hasPending = true;
          break;
        }
      }
      if (!hasPending) return;

      _running = true;
      startBtn.disabled = true;
      startBtn.textContent = msg("cherryPickInProgress");

      branches.forEach(function (b) {
        if (b.status === "error") {
          b.status = "pending";
          b.error = "";
        }
      });
      renderBranches();

      // Fallback: replay commit via Commits API, excluding version file
      // Only works when the sole conflict is in the version file.
      // Modified files must match the parent or accept the exact diff hunks.
      // Never interpret permission/network failures as an absent file.

      // Commit diff endpoint is paginated (20 files by default) — a
      // partial diff would silently replay only part of the commit

      let idx = 0;
      function processNext() {
        while (idx < branches.length && branches[idx].status !== "pending")
          idx++;
        if (idx >= branches.length) {
          _running = false;
          startBtn.disabled = false;
          startBtn.textContent = msg("cherryPickStart");
          let successCount = 0;
          let errorCount = 0;
          branches.forEach(function (b) {
            if (b.status === "success") successCount++;
            if (b.status === "error") errorCount++;
          });
          if (errorCount === 0 && successCount > 0) {
            let toastMsg;
            try {
              toastMsg = chrome.i18n.getMessage("cherryPickAllSuccess", [
                String(successCount),
              ]);
            } catch {
              toastMsg = "";
            }
            if (!toastMsg)
              toastMsg = "Cherry-picked to " + successCount + " branches";
            showToast(toastMsg, "success");
          }
          return;
        }

        branches[idx].status = "in_progress";
        renderBranches();

        const useFallback = fallbackCheckbox.checked;
        const branchState = branches[idx];
        const targetBranch = branchState.name;
        // Retain completed steps for retries in this modal. In particular,
        // an MR creation error must not replay or discard a successful pick.
        // Changing MR mode explicitly selects a different destination.
        if (
          !branchState.operation ||
          branchState.operation.createMr !== mrCheckbox.checked
        ) {
          branchState.operation = {
            createMr: mrCheckbox.checked,
            commitBranch: mrCheckbox.checked
              ? "cherry-pick-" +
                shortSha +
                "-into-" +
                targetBranch.replace(/\//g, "-")
              : targetBranch,
            branchCreated: false,
            commitApplied: false,
            mrAttempted: false,
          };
        }
        const operation = branchState.operation;
        picker
          .pick(operation, targetBranch, useFallback)
          .then(function (mr) {
            branchState.status = "success";
            if (mr && mr.web_url) branchState.mrUrl = mr.web_url;
            renderBranches();
            idx++;
            processNext();
          })
          .catch(function (err: unknown) {
            branchState.status = "error";
            branchState.error = errorMessage(err) || String(err);
            renderBranches();
            idx++;
            processNext();
          });
      }

      processNext();
    });

    function closeModal() {
      overlay.remove();
      removeKey();
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeModal();
    }

    closeBtn.addEventListener("click", closeModal);
    cancelBtn.addEventListener("click", closeModal);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeModal();
    });
    const removeKey = scope.listen(document, "keydown", onKey);

    document.body.appendChild(overlay);
    input.focus();
  }
  return { open: openCherryPickModal };
}
