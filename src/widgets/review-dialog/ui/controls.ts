import type * as Workflow from "../../../entities/review";
import type { ReviewContext, FileFilter } from "../../../entities/review";
import type { Note, Discussion } from "../../../entities/discussion";
import type { DiffRefs } from "../../../entities/merge-request";
import type {
  createReviewExporter,
  ReviewSnapshot,
  ExportOptions,
} from "../../../features/review-export";
import type { createReviewImporter } from "../../../features/review-import";
import { element } from "../../../shared/ui/dom";
import type { Translate } from "../../../shared/i18n";
import type {
  ReviewDialogState,
  ReviewTask,
  ReviewIntent,
  ReviewSettings,
  ImportDialog,
} from "./types";

export function startReviewControls(
  data: ReturnType<typeof createReviewExporter>,
  getWorkflow: () => typeof Workflow | null,
  getImporter: () => ReturnType<typeof createReviewImporter> | undefined,
  getImportDialog: () => ImportDialog | undefined,
) {
  if (!document.querySelector('meta[content="GitLab"], body[data-page]'))
    return;
  const settings: ReviewSettings = {
    show_ai_review_copy: true,
    ai_review_prompt: data.DEFAULT_PROMPT,
    ai_review_fresh_prompt: data.DEFAULT_FRESH_REVIEW_PROMPT,
    ai_review_file_filter: {},
    ai_review_include_description: null,
    ai_review_fresh_existing: false,
    ai_review_reply_prompt: "",
    ai_review_repeat_prompt: "",
    language: "auto",
    ai_review_confirm_close: false,
  };
  if (getWorkflow())
    Object.assign(settings, getWorkflow()!.instructionDefaults());
  let messages: Record<string, { message: string }> | null = null;
  settings.ai_review_confirm_close = false;
  let active: ReviewDialogState | null = null;
  let disposed = false;
  let pageKey = "";
  let mountTimer: ReturnType<typeof setTimeout> | null;
  let languageRun = 0;
  let descriptionSaveRun = 0;
  let relativeRoot: string | undefined;

  function t(key: string, substitutions?: Parameters<Translate>[1]) {
    let text = messages && messages[key] && messages[key].message;
    if (!text) {
      try {
        text = chrome.i18n.getMessage(key, substitutions?.map(String));
      } catch {
        /* The browser API may be unavailable. */
      }
      if (text) return text;
    }
    return String(text || key).replace(/\$(\d+)/g, function (match, number) {
      return substitutions && substitutions[Number(number) - 1] !== undefined
        ? String(substitutions[Number(number) - 1])
        : match;
    });
  }

  function button(
    key: string,
    onClick: (event: MouseEvent) => void,
    className?: string,
  ) {
    const el = element(
      "button",
      "gl-review-button" + (className ? " " + className : ""),
      t(key),
    );
    el.type = "button";
    el.addEventListener("click", onClick);
    return el;
  }

  function iconButton(
    key: string,
    onClick: (event: MouseEvent) => void,
    picker?: boolean | "import",
  ) {
    const el = button(key, onClick, "gl-review-icon-button");
    el.setAttribute("title", t(key));
    el.setAttribute("aria-label", t(key));
    const icon = element("span", "gl-review-icon");
    icon.setAttribute("aria-hidden", "true");
    // Fixed extension-owned SVG; no comment or other page content enters HTML.
    icon.innerHTML =
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true">' +
      (picker === "import"
        ? '<path d="M3 14v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5M10 3v11m-4-4 4 4 4-4"/>'
        : picker
          ? '<path d="M14 3H5a2 2 0 0 0-2 2v12l4-3h10a2 2 0 0 0 2-2v-2M8 18h7l4 3v-5"/>'
          : '<rect x="3" y="7" width="12" height="14" rx="2"/><path d="M7 7V5a2 2 0 0 1 2-2h5M15 17h2a2 2 0 0 0 2-2v-4"/>') +
      '<path d="m19 2 1.1 2.9L23 6l-2.9 1.1L19 10l-1.1-2.9L15 6l2.9-1.1L19 2Z"/></svg>';
    el.replaceChildren(icon);
    return el;
  }

  function route() {
    if (relativeRoot !== undefined) {
      return data.parsePage({
        origin: window.location.origin,
        pathname: window.location.pathname,
        relativeUrlRoot: relativeRoot,
      });
    }
    let prefix = "";
    const meta = document.querySelector<HTMLMetaElement>(
      'meta[name="gitlab-relative-url-root"], meta[name="relative-url-root"]',
    );
    if (meta) prefix = meta.content || "";
    if (!prefix && document.body)
      prefix = document.body.getAttribute("data-relative-url-root") || "";
    if (!prefix) {
      // gon is in the page's JS world; read just its JSON string, never execute it.
      const scripts = document.querySelectorAll("script:not([src])");
      for (let i = 0; i < scripts.length; i++) {
        const match = (scripts[i].textContent || "").match(
          /(?:gon\.)?"?relative_url_root"?\s*(?:=|:)\s*("(?:[^"\\]|\\.)*")/,
        );
        if (match) {
          try {
            prefix = JSON.parse(match[1]);
          } catch {
            /* The browser API may be unavailable. */
          }
          break;
        }
      }
    }
    relativeRoot = typeof prefix === "string" ? prefix : "";
    return data.parsePage({
      origin: window.location.origin,
      pathname: window.location.pathname,
      relativeUrlRoot: relativeRoot,
    });
  }

  function contextKey(context: ReviewContext | null) {
    return context
      ? context.origin +
          "/" +
          context.projectPath +
          "/" +
          context.kind +
          "/" +
          context.iid
      : "";
  }

  function copyValues(state: ReviewDialogState) {
    const prompts = Object.assign({}, state.prompts);
    if (state.promptMode) prompts[state.promptMode] = state.prompt.value;
    return JSON.stringify([
      prompts,
      state.filterFields.map(function (field) {
        return field.input.value;
      }),
      state.filter.value,
      state.search.value,
      state.includeGeneral.checked,
      state.includeDescription.checked,
      state.includeCode.checked,
      state.includeExisting.checked,
      state.includeReplies.checked,
      state.baseline.value,
      state.baselineSha.value,
    ]);
  }

  function hasChanges(state: ReviewDialogState) {
    return (
      state.initialValues !== copyValues(state) ||
      (state.initialSelection != null &&
        state.initialSelection !==
          JSON.stringify(Array.from(state.selected).sort()))
    );
  }

  function close(force?: boolean | Event) {
    if (!active) return true;
    if (
      force !== true &&
      settings.ai_review_confirm_close === true &&
      hasChanges(active) &&
      typeof window.confirm === "function" &&
      !window.confirm(t("aiReviewConfirmDiscard"))
    )
      return false;
    const old = active;
    active = null;
    if (old.loadController) old.loadController.abort();
    if (old.exportController) old.exportController.abort();
    if (old.versionsController) old.versionsController.abort();
    old.overlay.remove();
    document.removeEventListener("keydown", old.onKeydown, true);
    if (old.previousFocus && old.previousFocus.isConnected)
      old.previousFocus.focus();
    return true;
  }

  function isCurrent(state: ReviewDialogState) {
    return (
      active === state && contextKey(route()) === contextKey(state.context)
    );
  }

  function status(state: ReviewDialogState, text: string, error?: boolean) {
    state.status.textContent = text;
    state.status.classList.toggle("gl-review-error", !!error);
  }

  function invalidate(state: ReviewDialogState) {
    state.exportRun++;
    if (state.exportController) state.exportController.abort();
    state.prepared = null;
    state.preview.value = "";
    state.size.textContent = "";
    state.busy = false;
    updateActions(state);
  }

  function rememberDescription(state: ReviewDialogState) {
    const run = ++descriptionSaveRun;
    settings.ai_review_include_description = state.includeDescription.checked;
    if (state.descriptionSaveFailed) {
      state.descriptionSaveFailed = false;
      status(state, "");
    }
    function failed(error: unknown) {
      if (!error || !isCurrent(state) || run !== descriptionSaveRun) return;
      state.descriptionSaveFailed = true;
      status(state, t("settingsSaveFailed"), true);
    }
    try {
      chrome.storage.sync.set(
        {
          ai_review_include_description: settings.ai_review_include_description,
        },
        function () {
          failed(chrome.runtime.lastError);
        },
      );
    } catch (error) {
      failed(error);
    }
  }

  function rememberExisting(state: ReviewDialogState) {
    settings.ai_review_fresh_existing = state.includeExisting.checked;
    try {
      chrome.storage.sync.set(
        { ai_review_fresh_existing: settings.ai_review_fresh_existing },
        function () {
          if (chrome.runtime.lastError && isCurrent(state))
            status(state, t("settingsSaveFailed"), true);
        },
      );
    } catch {
      if (isCurrent(state)) status(state, t("settingsSaveFailed"), true);
    }
  }

  function chosenCount(state: ReviewDialogState) {
    return state.selected.size;
  }

  function selectedDiscussionIds(state: ReviewDialogState, replies?: boolean) {
    return (state.snapshot ? state.snapshot!.discussions : [])
      .filter(function (thread) {
        const notes = data.getNotes(thread).filter(function (note) {
          return !note.draft && !/^draft:/.test(String(note.id));
        });
        if (
          replies &&
          (!/^[a-f0-9]{40}$/i.test(thread.id) ||
            notes.some(function (note) {
              return (
                note.noteable_type && note.noteable_type !== "MergeRequest"
              );
            }))
        )
          return false;
        return notes.some(function (note) {
          return state.selected.has(String(note.id));
        });
      })
      .map(function (thread) {
        return String(thread.id);
      });
  }

  const taskKeys = {
    fresh: "aiReviewTaskReview",
    feedback: "aiReviewTaskFix",
    replies: "aiReviewTaskReply",
    repeat: "aiReviewTaskRepeat",
  };
  function freshReview(state: ReviewDialogState) {
    return state.context.kind === "merge_requests" && state.task === "fresh";
  }

  function setTask(state: ReviewDialogState, task: ReviewTask) {
    if (
      !isCurrent(state) ||
      state.context.kind !== "merge_requests" ||
      state.task === task
    )
      return;
    state.task = task;
    state.taskChanged = true;
    state.previewDetails.open = false;
    if (task === "fresh" && state.loading) {
      state.loadController!.abort();
      state.loadController = null;
      state.loading = false;
      state.needsLoad = true;
    }
    invalidate(state);
    if (task === "fresh") state.retryButton.hidden = true;
    showWarnings(state, []);
    status(state, "");
    if (
      task !== "fresh" &&
      (!state.snapshot || state.needsLoad) &&
      !state.loading
    )
      load(state, true);
    if (task === "repeat") loadVersions(state);
    state.body.scrollTop = 0;
    state.output.scrollTop = 0;
  }

  function loadVersions(state: ReviewDialogState) {
    if (state.versionsController || !getWorkflow()) return;
    state.versionsController = new AbortController();
    data
      .loadReviewVersions(state.context, {
        signal: state.versionsController.signal,
      })
      .then(function (result) {
        if (!isCurrent(state)) return;
        result.items.forEach(function (entry) {
          const date = new Date(entry.createdAt || "");
          const option = element(
            "option",
            "",
            "#" +
              entry.id +
              " · " +
              entry.headSha.slice(0, 10) +
              (Number.isFinite(date.getTime())
                ? " · " + date.toLocaleString()
                : ""),
          );
          option.value = entry.headSha;
          state.baseline.appendChild(option);
        });
        if (result.warnings.length)
          state.versionsHint.textContent =
            t("aiReviewPreviousHint") + " " + result.warnings.join(" ");
      })
      .catch(function (error) {
        if (isCurrent(state) && error.name !== "AbortError")
          state.versionsHint.textContent =
            t("aiReviewPreviousHint") + " " + error.message;
      });
  }

  function intentThread(state: ReviewDialogState) {
    return (
      state.snapshot &&
      state.intent.noteId &&
      state.snapshot!.discussions.find(function (thread) {
        return data.getNotes(thread).some(function (note) {
          return String(note.id) === state.intent.noteId;
        });
      })
    );
  }

  function updateActions(state: ReviewDialogState) {
    const fresh = freshReview(state),
      mode = state.task,
      mr = state.context.kind === "merge_requests";
    if (state.promptMode !== mode) {
      if (state.promptMode)
        state.prompts[state.promptMode] = state.prompt.value;
      state.promptMode = mode;
      state.prompt.value = state.prompts[mode];
    }
    state.promptLabel.textContent = t("aiReviewTaskPrompt");
    state.prompt.setAttribute("aria-label", state.promptLabel.textContent);
    state.tabs.forEach(function (tab) {
      const selected = tab.dataset.task === mode;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    if (mr) state.body.setAttribute("aria-labelledby", "gl-review-tab-" + mode);
    state.body.classList.toggle("gl-review-single-column", fresh);
    state.picker.hidden = fresh;
    state.contextHint.hidden = mode !== "feedback";
    state.taskHint.textContent = t(
      {
        fresh: "aiReviewTaskReviewHint",
        feedback: "aiReviewTaskFixHint",
        replies: "aiReviewTaskReplyHint",
        repeat: "aiReviewTaskRepeatHint",
      }[mode],
    );
    if (mode === "feedback" && (!mr || !state.includeReplies.checked))
      state.taskHint.textContent = t("aiReviewTaskFixOnlyHint");
    state.repliesToggle.hidden = !mr || mode !== "feedback";
    state.repeatOptions.hidden = mode !== "repeat";
    state.scopeOptions.hidden =
      !mr || !getWorkflow() || mode === "replies" || mode === "feedback";
    state.descriptionToggle.hidden = mode === "replies";
    state.codeToggle.hidden = !fresh && mode !== "repeat";
    state.codeHint.hidden = state.codeToggle.hidden;
    state.existingToggle.hidden = !fresh;
    state.existingHint.hidden = !fresh;
    const enabled = !!state.snapshot && !state.loading && !state.busy;
    const hasContent =
      chosenCount(state) > 0 || (!mr && state.includeDescription.checked);
    const missingIntent =
      state.intent.noteId && !state.intentFound && !chosenCount(state);
    const replyCount = selectedDiscussionIds(state, true).length;
    const disabled = fresh
      ? !!state.busy
      : mode === "repeat"
        ? !!state.busy || !!state.loading
        : mode === "replies"
          ? !enabled || !replyCount
          : !enabled || !hasContent || !!missingIntent;
    state.previewButton.disabled = disabled;
    state.copyButton.disabled = disabled;
    state.baseline.disabled = !!state.busy;
    state.baselineSha.disabled = !!state.busy;
    state.allButton.disabled = !enabled;
    state.threadButton.disabled = !enabled;
    const thread = intentThread(state);
    state.threadButton.hidden = !thread || data.getNotes(thread).length < 2;
    state.selectButton.disabled = !enabled;
    state.unresolvedButton.disabled = !enabled;
    state.clearButton.disabled = !enabled;
    state.count.textContent = t("aiReviewSelectedCount", [chosenCount(state)]);
    state.cancelButton.hidden = !state.busy;
    state.refreshButton.disabled = !!state.loading;
    state.filter.disabled = !state.snapshot || !!state.loading;
    state.includeGeneral.disabled = state.filter.disabled;
    state.generalToggle.hidden = state.filter.value !== "unresolved";
    let summary = fresh
      ? t("aiReviewSummaryFresh")
      : mode === "feedback"
        ? t("aiReviewSummaryFix", [chosenCount(state)])
        : t(
            mode === "replies"
              ? "aiReviewSummaryReplies"
              : "aiReviewSummaryRepeat",
            [
              mode === "replies"
                ? replyCount
                : selectedDiscussionIds(state).length,
            ],
          );
    if (mode !== "replies")
      summary +=
        " " +
        t(
          state.includeDescription.checked
            ? "aiReviewSummaryDescriptionOn"
            : "aiReviewSummaryDescriptionOff",
        );
    if (fresh || mode === "repeat") {
      summary +=
        " " +
        t(
          state.includeCode.checked
            ? "aiReviewSummaryCodeOn"
            : "aiReviewSummaryCodeOff",
        );
      if (
        state.filterFields.some(function (field) {
          return field.input.value.trim();
        })
      )
        summary += " " + t("aiReviewSummaryFiltered");
    }
    if (fresh)
      summary +=
        " " +
        t(
          state.includeExisting.checked
            ? "aiReviewSummaryExistingOn"
            : "aiReviewSummaryExistingOff",
        );
    if (mode === "repeat" && !state.baseline.value)
      summary += " " + t("aiReviewSummaryFullRepeat");
    if (
      mode === "replies" &&
      state.snapshot &&
      state.snapshot!.discussions.filter(function (thread) {
        return data.getNotes(thread).some(function (note) {
          return state.selected.has(String(note.id));
        });
      }).length !== replyCount
    )
      summary += " " + t("aiReviewSummaryDraftsExcluded");
    state.taskSummary.textContent = summary;
    state.nextStep.textContent = t(
      mode === "feedback"
        ? mr && state.includeReplies.checked
          ? "aiReviewNextFixStep"
          : "aiReviewNextFixOnlyStep"
        : "aiReviewNextStep",
    );
    state.emptyHint.hidden =
      fresh || mode === "repeat" || !!chosenCount(state) || !!state.loading;
  }

  function showWarnings(state: ReviewDialogState, warnings: string[]) {
    state.warning.replaceChildren();
    state.warning.hidden = !warnings.length;
    if (!warnings.length) return;
    state.warning.appendChild(element("strong", "", t("aiReviewPartial")));
    const details = element("details");
    details.appendChild(element("summary", "", String(warnings.length)));
    const list = element("ul");
    warnings.forEach(function (warning) {
      list.appendChild(element("li", "", warning));
    });
    details.appendChild(list);
    state.warning.appendChild(details);
  }

  function positionText(note: Note) {
    const p = note.position || note.original_position;
    if (!p) return "";
    const path = p.new_path || p.old_path || "";
    const line = p.new_line || p.old_line;
    return path + (line ? ":" + line : "");
  }

  function earlierRevision(thread: Discussion, snapshot: ReviewSnapshot) {
    const entity = snapshot.entity || {};
    const refs: Partial<DiffRefs> = entity.diff_refs || {};
    return (
      thread.outdated === true ||
      data.getNotes(thread).some(function (note) {
        if (note.outdated === true) return true;
        const p = note.original_position || note.position;
        if (!p) return false;
        return !!(
          (p.head_sha &&
            (entity.sha || refs.head_sha) &&
            p.head_sha !== (entity.sha || refs.head_sha)) ||
          (p.base_sha && refs.base_sha && p.base_sha !== refs.base_sha) ||
          (p.start_sha && refs.start_sha && p.start_sha !== refs.start_sha)
        );
      })
    );
  }

  function matchesStatus(state: ReviewDialogState, thread: Discussion) {
    const value = state.filter.value;
    const threadStatus = data.getStatus(thread);
    return (
      value === "all" ||
      threadStatus === value ||
      (value === "unresolved" &&
        state.includeGeneral.checked &&
        threadStatus === "general")
    );
  }

  function visibleThreads(state: ReviewDialogState) {
    if (!state.snapshot) return [];
    const query = state.search.value.trim().toLowerCase();
    return state.snapshot!.discussions.filter(function (thread) {
      const notes = data.getNotes(thread!);
      if (!notes.length) return false;
      if (!matchesStatus(state, thread)) return false;
      if (!query) return true;
      return notes.some(function (note) {
        return (
          [
            note.body,
            positionText(note),
            note.author && note.author.name,
            note.author && note.author.username,
          ]
            .join(" ")
            .toLowerCase()
            .indexOf(query) !== -1
        );
      });
    });
  }

  function renderThreads(state: ReviewDialogState) {
    state.list.replaceChildren();
    const threads = visibleThreads(state);
    if (!threads.length)
      state.list.appendChild(
        element("p", "gl-review-muted", t("aiReviewEmpty")),
      );
    threads.forEach(function (thread) {
      const notes = data.getNotes(thread!);
      const card = element("article", "gl-review-thread");
      const heading = element("div", "gl-review-thread-heading");
      const label = element("label", "gl-review-thread-label");
      const check = element("input");
      check.type = "checkbox";
      const selected = notes.filter(function (note) {
        return state.selected.has(String(note.id));
      }).length;
      check.checked = selected === notes.length;
      check.indeterminate = selected > 0 && selected < notes.length;
      check.setAttribute("aria-label", t("aiReviewScopeThread"));
      label.appendChild(check);
      const stateKey = {
        unresolved: "aiReviewUnresolved",
        resolved: "aiReviewResolved",
        general: "aiReviewGeneral",
      }[data.getStatus(thread)];
      label.appendChild(
        element("span", "gl-review-badge", t(stateKey || "aiReviewGeneral")),
      );
      if (earlierRevision(thread, state.snapshot!))
        label.appendChild(
          element("span", "gl-review-muted", t("aiReviewOutdated")),
        );
      const location = positionText(notes[0]);
      if (location)
        label.appendChild(element("span", "gl-review-path", location));
      heading.appendChild(label);
      const link = element("a", "gl-review-link", "↗");
      link.href =
        notes[0].web_url ||
        state.context.webUrl + "#note_" + encodeURIComponent(notes[0].id);
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.setAttribute("aria-label", t("aiReviewLink"));
      heading.appendChild(link);
      card.appendChild(heading);
      check.addEventListener("change", function () {
        state.selectionEdited = true;
        notes.forEach(function (note) {
          if (check.checked) state.selected.add(String(note.id));
          else state.selected.delete(String(note.id));
        });
        invalidate(state);
        // Keep focus and expanded replies while updating checkbox states.
        syncChecks(state);
      });
      check.dataset.reviewThread = String(thread.id);

      notes.forEach(function (note, index) {
        const row = element("div", "gl-review-note");
        const noteLabel = element("label", "gl-review-note-label");
        const noteCheck = element("input");
        noteCheck.type = "checkbox";
        noteCheck.checked = state.selected.has(String(note.id));
        noteCheck.dataset.reviewNote = String(note.id);
        noteCheck.setAttribute(
          "aria-label",
          t("aiReviewScopeComment") + " #" + note.id,
        );
        noteCheck.addEventListener("change", function () {
          state.selectionEdited = true;
          if (noteCheck.checked) state.selected.add(String(note.id));
          else state.selected.delete(String(note.id));
          invalidate(state);
          syncChecks(state);
        });
        noteLabel.appendChild(noteCheck);
        const author = note.author || {};
        noteLabel.appendChild(
          element(
            "strong",
            "",
            author.name || author.username || "#" + note.id,
          ),
        );
        if (note.created_at) {
          const date = new Date(note.created_at);
          if (!isNaN(date.getTime()))
            noteLabel.appendChild(
              element("time", "gl-review-muted", date.toLocaleString()),
            );
        }
        row.appendChild(noteLabel);
        row.appendChild(element("pre", "gl-review-note-text", note.body || ""));
        if (index === 0) card.appendChild(row);
        else {
          let replies = card.querySelector("details");
          if (!replies) {
            replies = element("details", "gl-review-replies");
            replies.appendChild(
              element(
                "summary",
                "",
                t("aiReviewShowReplies") + " (" + (notes.length - 1) + ")",
              ),
            );
            // A directly selected reply should be visible on opening the picker.
            replies.open = !!state.intent.noteId;
            card.appendChild(replies);
          }
          replies.appendChild(row);
        }
      });
      state.list.appendChild(card);
    });
    updateActions(state);
  }

  function syncChecks(state: ReviewDialogState) {
    state.list
      .querySelectorAll<HTMLInputElement>("[data-review-note]")
      .forEach(function (check) {
        check.checked = state.selected.has(check.dataset.reviewNote!);
      });
    state.list
      .querySelectorAll<HTMLInputElement>("[data-review-thread]")
      .forEach(function (check) {
        const thread = state.snapshot!.discussions.find(function (item) {
          return String(item.id) === check.dataset.reviewThread;
        });
        const notes = data.getNotes(thread!);
        const count = notes.filter(function (note) {
          return state.selected.has(String(note.id));
        }).length;
        check.checked = count === notes.length;
        check.indeterminate = count > 0 && count < notes.length;
      });
  }

  function selection(state: ReviewDialogState) {
    const discussionIds: string[] = [];
    const noteIds: string[] = [];
    state.snapshot!.discussions.forEach(function (thread) {
      const notes = data.getNotes(thread!);
      const chosen = notes.filter(function (note) {
        return state.selected.has(String(note.id));
      });
      if (chosen.length && chosen.length === notes.length)
        discussionIds.push(String(thread.id));
      else
        chosen.forEach(function (note) {
          noteIds.push(String(note.id));
        });
    });
    return { discussionIds: discussionIds, noteIds: noteIds };
  }

  function copyPrepared(state: ReviewDialogState) {
    if (!isCurrent(state) || !state.prepared) return Promise.resolve();
    // Copy from a fresh user gesture when available; keep a selectable preview
    // if clipboard permissions or lost activation prevent an asynchronous copy.
    const prepared = state.prepared;
    const text = prepared.text;
    function currentCopy() {
      return isCurrent(state) && state.prepared === prepared;
    }
    function manual() {
      if (!currentCopy()) return;
      state.previewDetails.open = true;
      state.preview.focus();
      state.preview.select();
      let copied = false;
      try {
        copied = document.execCommand("copy");
      } catch {
        /* The browser API may be unavailable. */
      }
      status(
        state,
        t(copied ? "aiReviewCopied" : "aiReviewManualCopy"),
        !copied,
      );
    }
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      manual();
      return Promise.resolve();
    }
    return navigator.clipboard.writeText(text).then(function () {
      if (currentCopy()) status(state, t("aiReviewCopied"));
    }, manual);
  }

  function fileFilter(state: ReviewDialogState) {
    if (!getWorkflow()) return undefined;
    const value: Partial<FileFilter> = {};
    state.filterFields.forEach(function (field) {
      value[field.key] = field.input.value;
    });
    return getWorkflow()!.normalizeFilter(value);
  }

  function repeatReview(state: ReviewDialogState, copy: boolean) {
    if (
      !isCurrent(state) ||
      state.busy ||
      state.loading ||
      state.context.kind !== "merge_requests"
    )
      return;
    const discussionIds = selectedDiscussionIds(state);
    if (
      state.baseline.value === "manual" &&
      !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(state.baselineSha.value.trim())
    ) {
      status(state, t("aiReviewPreviousSha"), true);
      return;
    }
    let scope;
    try {
      scope = fileFilter(state);
    } catch {
      status(state, t("aiReviewFilterInvalid"), true);
      return;
    }
    if (state.loadController) state.loadController!.abort();
    state.loadController = null;
    state.loading = false;
    invalidate(state);
    showWarnings(state, []);
    const run = ++state.exportRun,
      controller = (state.exportController = new AbortController());
    state.busy = true;
    updateActions(state);
    status(state, t("aiReviewPreparing"));
    data
      .prepareRepeatReview(state.context, {
        signal: controller.signal,
        discussionIds: discussionIds,
        baselineHead:
          state.baseline.value === "manual"
            ? state.baselineSha.value.trim()
            : state.baseline.value,
        fileFilter: scope,
        includeCode: state.includeCode.checked,
        includeDescription: state.includeDescription.checked,
        prompt: state.prompt.value,
      })
      .then(function (result) {
        if (!isCurrent(state) || run !== state.exportRun) return;
        state.prepared = result;
        state.preview.value = result.text;
        state.size.textContent = t("aiReviewSize", [
          result.text.length.toLocaleString(),
        ]);
        showWarnings(state, result.warnings || []);
        state.previewDetails.open = !copy || state.previewDetails.open;
        status(state, t("aiReviewReady"));
        if (copy) return copyPrepared(state);
      })
      .catch(function (error) {
        if (
          isCurrent(state) &&
          run === state.exportRun &&
          error.name !== "AbortError"
        )
          status(state, error.message, true);
      })
      .then(function () {
        if (isCurrent(state) && run === state.exportRun) {
          state.busy = false;
          updateActions(state);
        }
      });
  }

  function prepareReplies(state: ReviewDialogState, copy: boolean) {
    if (
      !isCurrent(state) ||
      state.busy ||
      state.context.kind !== "merge_requests" ||
      !getImporter()
    )
      return;
    const discussionIds = selectedDiscussionIds(state, true);
    if (state.loading || !discussionIds.length) return;
    // This export loads its own context; a late picker response must not replace it.
    if (state.loadController) state.loadController!.abort();
    state.loadController = null;
    state.loading = false;
    invalidate(state);
    showWarnings(state, []);
    const run = ++state.exportRun;
    const controller = (state.exportController = new AbortController());
    state.busy = true;
    status(state, t("aiReviewImportPromptLoading"));
    updateActions(state);
    Promise.resolve()
      .then(function () {
        if (!isCurrent(state) || run !== state.exportRun) return;
        return getImporter()!.getReplyPrompt(state.context, {
          signal: controller.signal,
          discussionIds: discussionIds,
          prompt: state.prompt.value,
        });
      })
      .then(function (text) {
        if (!isCurrent(state) || run !== state.exportRun) return;
        state.prepared = { text: text! };
        state.preview.value = text!;
        state.size.textContent = t("aiReviewSize", [
          text!.length.toLocaleString(),
        ]);
        state.previewDetails.open = !copy || state.previewDetails.open;
        status(state, t("aiReviewReady"));
        if (copy) return copyPrepared(state);
      })
      .catch(function (error) {
        if (
          isCurrent(state) &&
          run === state.exportRun &&
          error.name !== "AbortError"
        ) {
          status(
            state,
            t("aiReviewImportPromptError") + ": " + error.message,
            true,
          );
        }
      })
      .then(function () {
        if (!isCurrent(state) || run !== state.exportRun) return;
        state.busy = false;
        updateActions(state);
      });
  }

  function prepare(state: ReviewDialogState, copy: boolean) {
    if (!isCurrent(state) || state.busy || state.copyButton.disabled) return;
    if (state.prepared) {
      if (copy) copyPrepared(state);
      else state.previewDetails.open = true;
      return;
    }
    if (state.task === "repeat") {
      repeatReview(state, copy);
      return;
    }
    if (state.task === "replies") {
      prepareReplies(state, copy);
      return;
    }
    const fresh = freshReview(state);
    if (fresh && state.loading) {
      state.loadController!.abort();
      state.loadController = null;
      state.loading = false;
    }
    const run = ++state.exportRun;
    state.exportController = new AbortController();
    state.busy = true;
    status(state, t("aiReviewPreparing"));
    updateActions(state);
    const opts: ExportOptions = fresh ? {} : selection(state);
    try {
      if (fresh) opts.fileFilter = fileFilter(state);
    } catch {
      state.busy = false;
      updateActions(state);
      status(state, t("aiReviewFilterInvalid"), true);
      return;
    }
    opts.prompt = state.prompt.value;
    opts.includeCode = state.includeCode.checked;
    if (fresh) opts.includeExisting = state.includeExisting.checked;
    opts.includeDescription = state.includeDescription.checked;
    opts.includeReplies =
      state.context.kind === "merge_requests" && state.includeReplies.checked;
    opts.signal = state.exportController.signal;
    opts.onProgress = function (progress) {
      if (
        !isCurrent(state) ||
        run !== state.exportRun ||
        progress.total == null
      )
        return;
      status(
        state,
        t("aiReviewCodeProgress", [progress.loaded, progress.total]),
      );
    };
    const request = fresh
      ? data.prepareFreshReview(state.context, opts)
      : data.prepareExport(state.snapshot!, opts);
    request
      .then(function (result) {
        if (!isCurrent(state) || run !== state.exportRun) return;
        state.prepared = result;
        state.previewDetails.open = !copy || state.previewDetails.open;
        state.preview.value = result.text;
        state.size.textContent = t("aiReviewSize", [
          result.text.length.toLocaleString(),
        ]);
        showWarnings(
          state,
          result.warnings ||
            (!fresh && state.snapshot && state.snapshot.warnings) ||
            [],
        );
        state.busy = false;
        updateActions(state);
        status(state, t("aiReviewReady"));
        if (copy) copyPrepared(state);
      })
      .catch(function (error) {
        if (!isCurrent(state) || run !== state.exportRun) return;
        state.busy = false;
        updateActions(state);
        if (error.name !== "AbortError")
          status(state, error.message || t("aiReviewLoadFailed"), true);
      });
  }

  function load(state: ReviewDialogState, preserve: boolean) {
    if (state.loadController) state.loadController!.abort();
    invalidate(state);
    const controller = new AbortController();
    state.loadController = controller;
    state.loading = true;
    state.retryButton.hidden = true;
    state.list.replaceChildren();
    status(state, t("aiReviewLoading"));
    updateActions(state);
    data
      .load(state.context, {
        noteId: state.intent.noteId,
        noteAnchor: state.intent.noteAnchor,
        visibleNote: state.intent.visibleNote,
        signal: controller.signal,
        onProgress: function (progress) {
          if (
            isCurrent(state) &&
            controller === state.loadController &&
            progress.phase === "discussions"
          ) {
            status(state, t("aiReviewLoaded", [progress.loaded]));
          }
        },
      })
      .then(function (snapshot) {
        if (!isCurrent(state) || controller !== state.loadController) return;
        state.snapshot = snapshot;
        state.needsLoad = false;
        state.loading = false;
        state.subject.textContent =
          (snapshot.entity && snapshot.entity.title) ||
          state.context.projectPath;
        const oldSelected = state.selected;
        state.selected = new Set();
        let foundIntent = false;
        snapshot.discussions.forEach(function (thread) {
          const notes = data.getNotes(thread!);
          const matchesFilter = matchesStatus(state, thread);
          const matchesIntent = notes.some(function (note) {
            return String(note.id) === state.intent.noteId;
          });
          if (matchesIntent) foundIntent = true;
          notes.forEach(function (note) {
            const id = String(note.id);
            const choose =
              preserve && state.selectionEdited
                ? oldSelected.has(id)
                : state.intent.noteId
                  ? matchesIntent && id === state.intent.noteId
                  : true;
            if (choose && matchesFilter) state.selected.add(id);
          });
        });
        state.intentFound = foundIntent;
        if (state.initialSelection == null)
          state.initialSelection = JSON.stringify(
            Array.from(state.selected).sort(),
          );
        showWarnings(state, snapshot.warnings || []);
        renderThreads(state);
        if (state.intent.noteId && !foundIntent) {
          status(
            state,
            t("aiReviewNoteUnavailable") + " (#" + state.intent.noteId + ")",
            true,
          );
          state.retryButton.hidden = false;
        } else {
          status(
            state,
            t("aiReviewLoaded", [
              snapshot.discussions.filter(function (thread) {
                return data.getNotes(thread).length;
              }).length,
            ]),
          );
          if (
            !preserve &&
            state.intent.noteId &&
            state.task === "feedback" &&
            !state.taskChanged
          )
            prepare(state, true);
        }
      })
      .catch(function (error) {
        if (!isCurrent(state) || controller !== state.loadController) return;
        state.loading = false;
        state.snapshot = null;
        updateActions(state);
        if (error.name !== "AbortError") {
          status(state, t("aiReviewLoadFailed") + ": " + error.message, true);
          state.retryButton.hidden = false;
        }
      });
  }

  function open(intent?: ReviewIntent) {
    const context = route();
    if (!context) return;
    if (getImportDialog() && getImportDialog()!.close() === false) return;
    if (close() === false) return;
    const state = {
      context: context,
      intent: intent || {},
      selected: new Set(),
      selectionEdited: false,
      exportRun: 0,
      previousFocus: document.activeElement as HTMLElement | null,
      task: "feedback",
      tabs: [] as HTMLButtonElement[],
      prompts: {
        feedback: settings.ai_review_prompt || data.DEFAULT_PROMPT,
        fresh:
          settings.ai_review_fresh_prompt || data.DEFAULT_FRESH_REVIEW_PROMPT,
        replies:
          settings.ai_review_reply_prompt ||
          (getImporter() && getImporter()!.DEFAULT_REPLY_PROMPT) ||
          "",
        repeat:
          settings.ai_review_repeat_prompt ||
          (getWorkflow() && getWorkflow()!.DEFAULT_REPEAT_PROMPT) ||
          "",
      },
    } satisfies Partial<ReviewDialogState> as ReviewDialogState;
    active = state;
    const overlay = (state.overlay = element("div", "gl-review-overlay"));
    const dialog = element("section", "gl-review-dialog");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "gl-review-title");
    const header = element("header", "gl-review-header");
    const titleBox = element("div");
    const title = element("h2", "", t("aiReviewTitle"));
    title.id = "gl-review-title";
    titleBox.appendChild(title);
    state.subject = element(
      "p",
      "gl-review-subject",
      context.projectPath +
        (context.kind === "issues" ? " #" : " !") +
        context.iid,
    );
    titleBox.appendChild(state.subject);
    header.appendChild(titleBox);
    header.appendChild(button("aiReviewClose", close));
    dialog.appendChild(header);
    const tabs = element("div", "gl-review-tabs");
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", t("aiReviewChooseTask"));
    tabs.hidden = context.kind !== "merge_requests";
    (Object.keys(taskKeys) as ReviewTask[]).forEach(
      function (task, index, tasks) {
        const tab = button(taskKeys[task], function () {
          setTask(state, task);
        });
        tab.dataset.task = task;
        tab.id = "gl-review-tab-" + task;
        tab.setAttribute("role", "tab");
        tab.setAttribute("aria-controls", "gl-review-task-panel");
        tab.addEventListener("keydown", function (event) {
          const next =
            event.key === "ArrowRight"
              ? (index + 1) % tasks.length
              : event.key === "ArrowLeft"
                ? (index + tasks.length - 1) % tasks.length
                : event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? tasks.length - 1
                    : -1;
          if (next < 0) return;
          event.preventDefault();
          state.tabs[next].focus();
          setTask(state, tasks[next]);
        });
        state.tabs.push(tab);
        tabs.appendChild(tab);
      },
    );
    dialog.appendChild(tabs);
    state.status = element("div", "gl-review-status");
    state.status.setAttribute("role", "status");
    dialog.appendChild(state.status);
    state.warning = element("div", "gl-review-warning");
    state.warning.hidden = true;
    dialog.appendChild(state.warning);
    const body = (state.body = element("div", "gl-review-columns"));
    body.id = "gl-review-task-panel";
    if (context.kind === "merge_requests")
      body.setAttribute("role", "tabpanel");
    const left = (state.picker = element("section", "gl-review-picker"));
    const filters = element("div", "gl-review-filters");
    state.search = element("input");
    state.search.type = "search";
    state.search.placeholder = t("aiReviewSearch");
    state.search.setAttribute("aria-label", t("aiReviewSearch"));
    state.search.addEventListener("input", function () {
      renderThreads(state);
    });
    filters.appendChild(state.search);
    state.filter = element("select");
    state.filter.setAttribute("aria-label", t("aiReviewAll"));
    ["all", "unresolved", "resolved", "general"].forEach(function (value) {
      const option = element(
        "option",
        "",
        t("aiReview" + value.charAt(0).toUpperCase() + value.slice(1)),
      );
      option.value = value;
      state.filter.appendChild(option);
    });
    state.filter.value = state.intent.noteId ? "all" : "unresolved";
    state.filter.addEventListener("change", function () {
      if (state.filter.value !== "unresolved")
        state.includeGeneral.checked = false;
      state.selectionEdited = true;
      state.selected.clear();
      visibleThreads(state).forEach(function (thread) {
        data.getNotes(thread).forEach(function (note) {
          state.selected.add(String(note.id));
        });
      });
      invalidate(state);
      renderThreads(state);
    });
    const filterControl = element("span", "gl-review-select");
    filterControl.appendChild(state.filter);
    filters.appendChild(filterControl);
    left.appendChild(filters);
    state.generalToggle = element("label", "gl-review-general-toggle");
    state.includeGeneral = element("input");
    state.includeGeneral.type = "checkbox";
    state.includeGeneral.checked = false;
    state.includeGeneral.addEventListener("change", function () {
      if (!state.snapshot || state.filter.value !== "unresolved") return;
      const threads = state.includeGeneral.checked
        ? visibleThreads(state)
        : state.snapshot!.discussions;
      threads.forEach(function (thread) {
        if (data.getStatus(thread) !== "general") return;
        data.getNotes(thread).forEach(function (note) {
          if (state.includeGeneral.checked) state.selected.add(String(note.id));
          else state.selected.delete(String(note.id));
        });
      });
      invalidate(state);
      renderThreads(state);
    });
    state.generalToggle.appendChild(state.includeGeneral);
    state.generalToggle.appendChild(element("span", "", t("aiReviewGeneral")));
    left.appendChild(state.generalToggle);
    const tools = element("div", "gl-review-tools");
    state.unresolvedButton = button("aiReviewUnresolved", function () {
      state.filter.value = "unresolved";
      state.search.value = "";
      state.includeGeneral.checked = false;
      state.selectionEdited = true;
      state.selected.clear();
      visibleThreads(state).forEach(function (thread) {
        data.getNotes(thread).forEach(function (note) {
          state.selected.add(String(note.id));
        });
      });
      invalidate(state);
      renderThreads(state);
    });
    state.selectButton = button("aiReviewSelectShown", function () {
      state.selectionEdited = true;
      visibleThreads(state).forEach(function (thread) {
        data.getNotes(thread).forEach(function (note) {
          state.selected.add(String(note.id));
        });
      });
      invalidate(state);
      syncChecks(state);
    });
    state.clearButton = button("aiReviewClear", function () {
      state.selectionEdited = true;
      state.selected.clear();
      invalidate(state);
      syncChecks(state);
    });
    state.refreshButton = button("aiReviewRefresh", function () {
      load(state, true);
    });
    tools.appendChild(state.unresolvedButton);
    tools.appendChild(state.selectButton);
    tools.appendChild(state.clearButton);
    tools.appendChild(state.refreshButton);
    left.appendChild(tools);
    state.count = element("div", "gl-review-count");
    left.appendChild(state.count);
    state.list = element("div", "gl-review-list");
    left.appendChild(state.list);
    state.contextHint = element(
      "p",
      "gl-review-muted gl-review-context-hint",
      t("aiReviewCommentContext"),
    );
    left.appendChild(state.contextHint);
    body.appendChild(left);

    const right = (state.output = element("section", "gl-review-output"));
    state.taskHint = element("p", "gl-review-task-hint");
    right.appendChild(state.taskHint);
    state.taskSummary = element("p", "gl-review-task-summary");
    state.taskSummary.setAttribute("aria-live", "polite");
    right.appendChild(state.taskSummary);
    state.emptyHint = element(
      "p",
      "gl-review-muted",
      t("aiReviewChooseFeedback"),
    );
    right.appendChild(state.emptyHint);
    const advanced = element("details", "gl-review-advanced");
    advanced.appendChild(element("summary", "", t("aiReviewAdvanced")));
    const workflow = getWorkflow();
    const reviewOptions = element(
      "details",
      "gl-review-prompt-details gl-review-scope",
    );
    reviewOptions.hidden = !workflow || context.kind !== "merge_requests";
    reviewOptions.appendChild(element("summary", "", t("aiReviewFileFilters")));
    reviewOptions.appendChild(
      element("p", "gl-review-muted", t("aiReviewFileFiltersHint")),
    );
    state.filterFields = (workflow ? workflow.FILTER_FIELDS : []).map(
      function (key, index) {
        const label = element(
          "label",
          "gl-review-preview-label",
          t(
            [
              "aiReviewIncludeExtensions",
              "aiReviewIncludeFiles",
              "aiReviewIgnoreFiles",
              "aiReviewIgnoreDirs",
            ][index],
          ),
        );
        const input = element("textarea", "gl-review-prompt");
        input.rows = 2;
        input.maxLength = 1500;
        input.setAttribute("aria-label", label.textContent!);
        input.value =
          settings.ai_review_file_filter &&
          typeof settings.ai_review_file_filter[key] === "string"
            ? settings.ai_review_file_filter[key]
            : "";
        input.addEventListener("input", function () {
          invalidate(state);
        });
        label.appendChild(input);
        reviewOptions.appendChild(label);
        return { key: key, input: input };
      },
    );
    reviewOptions.appendChild(
      element("p", "gl-review-muted", t("aiReviewPromptSessionHint")),
    );
    state.scopeOptions = reviewOptions;
    advanced.appendChild(reviewOptions);
    const repeatOptions = element("div", "gl-review-repeat-options");
    repeatOptions.hidden = !workflow || context.kind !== "merge_requests";
    const baselineLabel = element(
      "label",
      "gl-review-preview-label",
      t("aiReviewPreviousRevision"),
    );
    state.baseline = element("select", "gl-review-filter");
    state.baseline.setAttribute("aria-label", t("aiReviewPreviousRevision"));
    const automatic = element("option", "", t("aiReviewPreviousNone"));
    automatic.value = "";
    state.baseline.appendChild(automatic);
    const manualOption = element("option", "", t("aiReviewPreviousManual"));
    manualOption.value = "manual";
    state.baseline.appendChild(manualOption);
    state.baseline.addEventListener("change", function () {
      state.baselineSha.hidden = state.baseline.value !== "manual";
      invalidate(state);
    });
    const baselineWrap = element("span", "gl-review-select");
    baselineWrap.appendChild(state.baseline);
    baselineLabel.appendChild(baselineWrap);
    repeatOptions.appendChild(baselineLabel);
    state.baselineSha = element("input", "gl-review-baseline-sha");
    state.baselineSha.type = "text";
    state.baselineSha.maxLength = 64;
    state.baselineSha.hidden = true;
    state.baselineSha.placeholder = t("aiReviewPreviousSha");
    state.baselineSha.setAttribute("aria-label", t("aiReviewPreviousSha"));
    state.baselineSha.addEventListener("input", function () {
      invalidate(state);
    });
    baselineLabel.appendChild(state.baselineSha);
    state.versionsHint = element(
      "p",
      "gl-review-muted gl-review-versions-hint",
      t("aiReviewPreviousHint"),
    );
    repeatOptions.appendChild(state.versionsHint);
    state.repeatOptions = repeatOptions;
    right.appendChild(repeatOptions);
    const include = element("label", "gl-review-description-toggle");
    state.includeDescription = element("input");
    state.includeDescription.type = "checkbox";
    state.includeDescription.checked =
      typeof settings.ai_review_include_description === "boolean"
        ? settings.ai_review_include_description
        : !state.intent.noteId;
    state.includeDescription.addEventListener("change", function () {
      invalidate(state);
      rememberDescription(state);
    });
    include.appendChild(state.includeDescription);
    include.appendChild(element("span", "", t("aiReviewIncludeDescription")));
    state.descriptionToggle = include;
    right.appendChild(include);
    state.repliesToggle = element(
      "label",
      "gl-review-description-toggle gl-review-replies-toggle",
    );
    state.includeReplies = element("input");
    state.includeReplies.type = "checkbox";
    state.includeReplies.checked = true;
    state.includeReplies.addEventListener("change", function () {
      invalidate(state);
    });
    state.repliesToggle.appendChild(state.includeReplies);
    state.repliesToggle.appendChild(
      element("span", "", t("aiReviewIncludeReplies")),
    );
    right.appendChild(state.repliesToggle);
    const codeToggle = element(
      "label",
      "gl-review-description-toggle gl-review-code-toggle",
    );
    codeToggle.hidden = context.kind !== "merge_requests";
    state.includeCode = element("input");
    state.includeCode.type = "checkbox";
    state.includeCode.checked = false;
    state.includeCode.addEventListener("change", function () {
      invalidate(state);
    });
    codeToggle.appendChild(state.includeCode);
    codeToggle.appendChild(element("span", "", t("aiReviewIncludeCode")));
    state.codeToggle = codeToggle;
    right.appendChild(codeToggle);
    const codeHint = element(
      "p",
      "gl-review-muted",
      t("aiReviewIncludeCodeHint"),
    );
    codeHint.hidden = codeToggle.hidden;
    state.codeHint = codeHint;
    right.appendChild(codeHint);
    state.existingToggle = element(
      "label",
      "gl-review-description-toggle gl-review-existing-toggle",
    );
    state.existingToggle.hidden = true;
    state.includeExisting = element("input");
    state.includeExisting.type = "checkbox";
    state.includeExisting.checked = settings.ai_review_fresh_existing === true;
    state.includeExisting.addEventListener("change", function () {
      invalidate(state);
      rememberExisting(state);
    });
    state.existingToggle.appendChild(state.includeExisting);
    state.existingToggle.appendChild(
      element("span", "", t("aiReviewIncludeExisting")),
    );
    right.appendChild(state.existingToggle);
    state.existingHint = element(
      "p",
      "gl-review-muted",
      t("aiReviewIncludeExistingHint"),
    );
    state.existingHint.hidden = true;
    right.appendChild(state.existingHint);
    const promptDetails = element("details", "gl-review-prompt-details");
    state.promptLabel = element("summary", "", t("aiReviewPrompt"));
    promptDetails.appendChild(state.promptLabel);
    state.prompt = element(
      "textarea",
      "gl-review-prompt gl-review-task-prompt",
    );
    state.prompt.value = settings.ai_review_prompt || data.DEFAULT_PROMPT;
    state.prompt.rows = 5;
    state.prompt.maxLength = 1500;
    state.prompt.setAttribute("aria-label", t("aiReviewPrompt"));
    state.prompt.addEventListener("input", function () {
      invalidate(state);
    });
    promptDetails.appendChild(state.prompt);
    promptDetails.appendChild(
      element("p", "gl-review-muted", t("aiReviewPromptSessionHint")),
    );
    promptDetails.appendChild(
      button("aiReviewResetPrompt", function () {
        state.prompt.value =
          {
            fresh: data.DEFAULT_FRESH_REVIEW_PROMPT,
            feedback: data.DEFAULT_PROMPT,
            replies: getImporter() && getImporter()!.DEFAULT_REPLY_PROMPT,
            repeat: workflow && workflow.DEFAULT_REPEAT_PROMPT,
          }[state.task] || "";
        invalidate(state);
      }),
    );
    advanced.appendChild(promptDetails);
    right.appendChild(advanced);
    state.previewDetails = element("details", "gl-review-preview-details");
    state.previewDetails.appendChild(
      element("summary", "", t("aiReviewPreview")),
    );
    right.appendChild(state.previewDetails);
    state.preview = element("textarea", "gl-review-preview");
    state.preview.id = "gl-review-preview";
    state.preview.readOnly = true;
    state.preview.spellcheck = false;
    state.preview.placeholder = t("aiReviewLoadHint");
    state.preview.setAttribute("aria-label", t("aiReviewPreview"));
    state.previewDetails.appendChild(state.preview);
    state.size = element("div", "gl-review-muted");
    state.previewDetails.appendChild(state.size);
    state.nextStep = element("p", "gl-review-muted gl-review-next-step");
    right.appendChild(state.nextStep);
    body.appendChild(right);
    dialog.appendChild(body);
    const footer = element("footer", "gl-review-footer");
    state.retryButton = button("aiReviewRetry", function () {
      load(state, false);
    });
    state.retryButton.hidden = true;
    footer.appendChild(state.retryButton);
    state.cancelButton = button("aiReviewCancel", function () {
      invalidate(state);
      status(state, "");
    });
    state.cancelButton.hidden = true;
    footer.appendChild(state.cancelButton);
    state.threadButton = button("aiReviewSelectThread", function () {
      const thread = intentThread(state);
      if (!thread) return;
      state.selectionEdited = true;
      state.selected.clear();
      data.getNotes(thread).forEach(function (note) {
        state.selected.add(String(note.id));
      });
      invalidate(state);
      syncChecks(state);
    });
    state.threadButton.hidden = true;
    tools.appendChild(state.threadButton);
    state.allButton = button("aiReviewSelectAll", function () {
      state.selectionEdited = true;
      state.filter.value = "all";
      state.search.value = "";
      state.includeGeneral.checked = false;
      state.snapshot!.discussions.forEach(function (thread) {
        data.getNotes(thread).forEach(function (note) {
          state.selected.add(String(note.id));
        });
      });
      invalidate(state);
      renderThreads(state);
    });
    tools.appendChild(state.allButton);
    const importButton = button(
      "aiReviewPasteResult",
      function () {
        if (!getImportDialog() || context.kind !== "merge_requests") return;
        if (close() !== false) getImportDialog()!.open(context, { t: t });
      },
      "gl-review-import-result",
    );
    importButton.hidden =
      context.kind !== "merge_requests" || !getImportDialog();
    footer.appendChild(importButton);
    state.previewButton = button("aiReviewPreview", function () {
      prepare(state, false);
    });
    footer.appendChild(state.previewButton);
    state.copyButton = button(
      "aiReviewCopyTask",
      function () {
        prepare(state, true);
      },
      "gl-review-primary",
    );
    footer.appendChild(state.copyButton);
    dialog.appendChild(footer);
    overlay.appendChild(dialog);
    overlay.addEventListener("click", function (event) {
      if (event.target === overlay) close();
    });
    state.onKeydown = function (event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
      }
      if (event.key === "Tab") {
        const targets = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            "button, input, select, textarea, summary, a[href]",
          ),
        ).filter(function (el) {
          return (
            !("disabled" in el && el.disabled) &&
            !el.hidden &&
            el.tabIndex !== -1 &&
            el.getClientRects().length
          );
        });
        if (!targets.length) return;
        const first = targets[0];
        const last = targets[targets.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            !dialog.contains(document.activeElement))
        ) {
          event.preventDefault();
          last.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last ||
            !dialog.contains(document.activeElement))
        ) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", state.onKeydown, true);
    document.body.appendChild(overlay);
    if (context.kind === "merge_requests") state.tabs[1].focus();
    else state.search.focus();
    state.initialValues = copyValues(state);
    load(state, false);
  }

  const noteSelector =
    '[id^="note_"], [id^="note-"], [id^="draft_"], [data-note-id]';

  function noteId(el: Element) {
    const id = (el.id || "").match(/^(?:note[_-]|draft_)(\d+)$/);
    if (id) return id[1];
    const attr = el.getAttribute("data-note-id");
    return /^\d+$/.test(attr || "") ? attr : null;
  }

  function noteKey(root: Element) {
    const id = noteId(root);
    if (!id) return null;
    // Older GitLab versions give drafts the same note_<id> anchor shape as
    // published notes. Their numeric IDs belong to different API resources.
    const draft =
      /^draft_\d+$/.test(root.id || "") ||
      !!root.closest(
        '.draft-note, .draft-note-component, .draft-notes, [data-testid="draft-note"]',
      );
    return (draft ? "draft:" : "") + id;
  }

  function noteIntent(root: Element) {
    const key = noteKey(root);
    if (!key) return null;
    const intent: ReviewIntent = { noteId: key, noteAnchor: root.id };
    if (key.indexOf("draft:") === 0) {
      // Never copy the entire note root: it also contains controls and may
      // contain other comments. This is only a fallback for older draft APIs.
      const saved = Array.from(
        root.querySelectorAll<HTMLTextAreaElement>(
          "textarea.hidden.js-task-list-field",
        ),
      ).find(function (el) {
        return (
          el.closest(noteSelector) === root &&
          el.closest(".note-body") &&
          !el.closest(".note-form") &&
          el.value.trim()
        );
      });
      if (saved) {
        intent.visibleNote = { body: saved.value, format: "markdown" };
        return intent;
      }
      const body = Array.from(
        root.querySelectorAll<HTMLElement>(
          '.note-text, [data-testid="work-item-note-body"]',
        ),
      ).find(function (el) {
        return el.closest(noteSelector) === root;
      });
      if (body) {
        const text = (
          typeof body.innerText === "string"
            ? body.innerText
            : body.textContent || ""
        ).trim();
        if (text) intent.visibleNote = { body: text, format: "text" };
      }
    }
    return intent;
  }

  function mount() {
    if (disposed) return;
    const context = route();
    const nextKey = contextKey(context);
    if (nextKey !== pageKey) {
      close(true);
      if (getImportDialog()) getImportDialog()!.close(true);
      document
        .querySelectorAll(".gl-review-launcher, .gl-review-inline")
        .forEach(function (el) {
          el.remove();
        });
      pageKey = nextKey;
    }
    if (!context || settings.show_ai_review_copy === false) return;
    let launcher = document.querySelector(
      ".gl-review-launcher:not(.gl-review-import-launcher)",
    );
    if (!launcher) {
      launcher = iconButton(
        "aiReviewOpen",
        function () {
          open();
        },
        true,
      );
      launcher.classList.add("gl-review-launcher");
    }
    // Keep the control in the actual action row, including when GitLab mounts
    // that row after the header or replaces it during client-side navigation.
    const header = document.querySelector(".detail-page-header");
    const nativeAction =
      header &&
      (header.querySelector(".js-sidebar-toggle") ||
        header.querySelector(".js-mr-more-dropdown") ||
        header.querySelector('[data-testid="edit-title-button"]'));
    const actions =
      (nativeAction && nativeAction.parentElement) ||
      document.querySelector(".js-issuable-actions") ||
      document.querySelector(".detail-page-header-actions");
    const target =
      actions ||
      document.querySelector(
        '.detail-page-header, .merge-request-details, .issue-details, [data-testid="work-item-title"], .detail-page-description',
      );
    launcher.classList.toggle("gl-review-in-actions", !!actions);
    launcher.classList.toggle("gl-review-floating", !target);
    const sidebarToggle =
      actions && actions.querySelector(".js-sidebar-toggle");
    if (sidebarToggle && sidebarToggle.parentElement === actions) {
      const children = Array.from(actions!.children);
      if (
        launcher.parentElement !== actions ||
        children.indexOf(launcher) + 1 !== children.indexOf(sidebarToggle)
      )
        actions!.insertBefore(launcher, sidebarToggle);
    } else if (launcher.parentElement !== (target || document.body))
      (target || document.body).appendChild(launcher);
    if (context.kind === "merge_requests" && getImportDialog()) {
      let importLauncher = document.querySelector(".gl-review-import-launcher");
      if (!importLauncher) {
        importLauncher = iconButton(
          "aiReviewImportOpen",
          function () {
            const current = route();
            if (!current || current.kind !== "merge_requests") return;
            if (close() === false) return;
            getImportDialog()!.open(current, { t: t });
          },
          "import",
        );
        importLauncher.classList.add("gl-review-launcher");
        importLauncher.classList.add("gl-review-import-launcher");
      }
      importLauncher.classList.toggle("gl-review-in-actions", !!actions);
      importLauncher.classList.toggle("gl-review-floating", !target);
      const siblings = Array.from(launcher.parentElement!.children);
      if (
        importLauncher.parentElement !== launcher.parentElement ||
        siblings.indexOf(importLauncher) + 1 !== siblings.indexOf(launcher)
      ) {
        launcher.parentElement!.insertBefore(importLauncher, launcher);
      }
    }
    document.querySelectorAll(noteSelector).forEach(function (root) {
      const id = noteId(root);
      if (
        !id ||
        root.closest(
          '.gl-review-overlay, .system-note, [data-system-note="true"]',
        )
      )
        return;
      // Modern work-item thread wrappers also have data-note-id. Attach to the
      // actual note, not its enclosing discussion or another note's inner node.
      const anchors =
        '[id="note_' +
        id +
        '"], [id="note-' +
        id +
        '"], [id="draft_' +
        id +
        '"]';
      const key = noteKey(root);
      if (
        Array.from(root.querySelectorAll(anchors)).some(function (el) {
          return noteKey(el) === key;
        })
      )
        return;
      const parentNote =
        root.parentElement && root.parentElement.closest(anchors);
      if (parentNote && noteKey(parentNote) === key) return;
      if (root.querySelector(".gl-review-inline")) return;
      const header = root.querySelector(
        '.note-header, [data-testid="note-header"]',
      );
      if (
        !header &&
        !root.querySelector(
          '.note-text, .note-body, [data-testid="work-item-note-body"]',
        )
      )
        return;
      const bar = element("span", "gl-review-inline");
      bar.appendChild(
        iconButton("aiReviewCopyComment", function (event) {
          event.stopPropagation();
          // GitLab can reuse a note node when a newly posted comment is saved.
          // Resolve its current ID on click instead of retaining the mounted ID.
          const intent = noteIntent(root);
          if (intent) open(intent);
        }),
      );
      (header || root).appendChild(bar);
    });
  }

  function scheduleMount() {
    if (mountTimer) return;
    mountTimer = setTimeout(function () {
      mountTimer = null;
      mount();
    }, 180);
  }

  function language() {
    const run = ++languageRun;
    messages = null;
    if (!settings.language || settings.language === "auto")
      return Promise.resolve();
    return fetch(
      chrome.runtime.getURL("_locales/" + settings.language + "/messages.json"),
    )
      .then(function (response) {
        return response.json();
      })
      .then(function (value) {
        if (run === languageRun) messages = value;
      })
      .catch(function () {});
  }

  chrome.storage.sync.get(settings, function (values) {
    if (chrome.runtime.lastError) return;
    Object.assign(settings, values);
    language().then(mount);
  });
  const onSettingsChanged = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => {
    if (area !== "sync") return;
    if (changes.ai_review_response_language && active) invalidate(active);
    let relevant = false;
    Object.keys(settings).forEach(function (key) {
      if (changes[key]) {
        settings[key] = changes[key].newValue;
        // A remembered checkbox value applies to future pickers. Saving it (or
        // receiving another tab's choice) must not close an ongoing export.
        if (
          key !== "ai_review_include_description" &&
          key !== "ai_review_fresh_existing" &&
          key !== "ai_review_confirm_close"
        )
          relevant = true;
      }
    });
    if (!relevant) return;
    if (close() === false) return;
    if (getImportDialog() && getImportDialog()!.close() === false) return;
    document
      .querySelectorAll(".gl-review-launcher, .gl-review-inline")
      .forEach(function (el) {
        el.remove();
      });
    language().then(mount);
  };
  chrome.storage.onChanged?.addListener(onSettingsChanged);
  const observer = new MutationObserver(function (records) {
    if (
      records.some(function (record) {
        return (
          !("closest" in record.target) ||
          !(record.target as Element).closest(
            ".gl-review-overlay, .gl-review-launcher, .gl-review-inline",
          )
        );
      })
    )
      scheduleMount();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["id", "data-note-id"],
  });
  window.addEventListener("popstate", scheduleMount);
  document.addEventListener("turbo:load", scheduleMount);
  document.addEventListener("turbolinks:load", scheduleMount);
  // pushState does not emit popstate; avoid altering GitLab's history functions.
  const routeTimer = setInterval(function () {
    if (contextKey(route()) !== pageKey) mount();
  }, 1000);
  return () => {
    disposed = true;
    observer.disconnect();
    if (mountTimer) clearTimeout(mountTimer);
    clearInterval(routeTimer);
    chrome.storage.onChanged?.removeListener(onSettingsChanged);
    window.removeEventListener("popstate", scheduleMount);
    document.removeEventListener("turbo:load", scheduleMount);
    document.removeEventListener("turbolinks:load", scheduleMount);
    close(true);
    document
      .querySelectorAll(".gl-review-launcher, .gl-review-inline")
      .forEach((el) => el.remove());
  };
}
