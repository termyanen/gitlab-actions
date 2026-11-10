import { getProjectSettings } from "../../../shared/api/project-settings";
import type { Job } from "../../../entities/pipeline";
import { readJob } from "../../../entities/pipeline";
import { createSessionApi } from "../../../shared/api/gitlab";
import { SEL } from "../../../shared/config/gitlab";
import { GITLAB_PAGE_SIZE } from "../../../shared/config/gitlab-api";
import { msg } from "../../../shared/i18n";
import { q, qAll, qUp } from "../../../shared/lib/dom";
import type { Lifecycle } from "../../../shared/lib/lifecycle";
import { createLifecycle } from "../../../shared/lib/lifecycle";
import {
  decodeArray,
  decoder,
  isNumber,
  isString,
  objectOf,
  optional,
  type Decoder,
} from "../../../shared/lib/validation";
import { isElement } from "../../../shared/ui/dom";
const readBridge = decoder(
  objectOf<Bridge>({
    downstream_pipeline: optional(
      objectOf({ id: isNumber, web_url: isString }),
    ),
  }),
);
const GRAPH_MOUNT_DEBOUNCE_MS = 300;
const GRAPH_REFRESH_INTERVAL_MS = 3000;
interface PipelineEntry {
  projectRef: string;
  stages: Record<string, Job[]>;
  jobIds: Record<number, boolean>;
}
interface Bridge {
  downstream_pipeline?: { id: number; web_url: string };
}
type PlayButton = HTMLButtonElement & { _glBusy?: boolean };

export function startPipelineActions(scope: Lifecycle = createLifecycle()) {
  const GITLAB_URL = window.location.origin;
  const api = createSessionApi(() => GITLAB_URL, scope.signal);
  function isPipelinePage() {
    return /\/-\/pipelines\/\d+/.test(window.location.pathname);
  }

  if (isPipelinePage()) {
    try {
      getProjectSettings(
        { show_group_play: true },
        scope.guard(function (s: { show_group_play: boolean }) {
          if (chrome.runtime.lastError || s.show_group_play === false) return;

          const pathMatch = window.location.pathname.match(
            /^\/(.+?)\/-\/pipelines\/(\d+)/,
          );
          if (!pathMatch?.[1] || !pathMatch[2]) return;
          const encodedProject = encodeURIComponent(pathMatch[1]);
          const pipelineId = pathMatch[2];

          const GROUP_JOBS_TTL = 10 * 1000; // graph statuses change often — short cache
          let _pipelinesCache: { list: PipelineEntry[]; at: number } | null =
            null; // { list: [pipeline entry], at: timestamp }
          let _pipelinesPromise: Promise<PipelineEntry[]> | null = null;

          function fetchPaged<T>(
            path: string,
            read: Decoder<T>,
            page = 1,
            acc: T[] = [],
          ): Promise<T[]> {
            page = page || 1;
            acc = acc || [];
            return api(
              "GET",
              path + "?per_page=" + GITLAB_PAGE_SIZE + "&page=" + page,
            )
              .then(decodeArray(read))
              .then(function (items) {
                if (!items || !items.length) return acc;
                acc = acc.concat(items);
                if (items.length === GITLAB_PAGE_SIZE && page < 20)
                  return fetchPaged(path, read, page + 1, acc);
                return acc;
              });
          }

          // Pipeline entry: { projectRef, stages: {stageName: [job]}, jobIds: {id: true} }
          function buildPipelineEntry(projectRef: string, jobs: Job[]) {
            const entry: PipelineEntry = {
              projectRef: projectRef,
              stages: {},
              jobIds: {},
            };
            for (const pipelineJob of jobs) {
              const st = pipelineJob.stage || "";
              if (!entry.stages[st]) entry.stages[st] = [];
              entry.stages[st].push(pipelineJob);
              entry.jobIds[pipelineJob.id] = true;
            }
            return entry;
          }

          // Parent pipeline + downstream (child) pipelines triggered by bridges —
          // their graphs render on the same page when expanded, with their own ids
          function getPipelines() {
            if (
              _pipelinesCache &&
              Date.now() - _pipelinesCache.at < GROUP_JOBS_TTL
            ) {
              return Promise.resolve(_pipelinesCache.list);
            }
            if (_pipelinesPromise) return _pipelinesPromise;
            const base =
              "/projects/" + encodedProject + "/pipelines/" + pipelineId;
            _pipelinesPromise = Promise.all([
              fetchPaged(base + "/jobs", readJob),
              fetchPaged(base + "/bridges", readBridge).catch(function () {
                return [];
              }),
            ]).then(function (res) {
              const children = [];
              for (const bridge of res[1]) {
                const dp = bridge.downstream_pipeline;
                if (!dp || !dp.id) continue;
                // project path from web_url — bridges API has no project_id field
                let ref = encodedProject;
                try {
                  const pm = new URL(dp.web_url).pathname.match(
                    /^\/(.+?)\/-\/pipelines\/\d+/,
                  );
                  if (pm?.[1]) ref = encodeURIComponent(pm[1]);
                } catch {
                  /* Optional UI may be unavailable. */
                }
                children.push({ id: dp.id, ref: ref });
              }
              return Promise.all(
                children.map(function (child) {
                  return fetchPaged(
                    "/projects/" +
                      child.ref +
                      "/pipelines/" +
                      child.id +
                      "/jobs",
                    readJob,
                  )
                    .then(function (jobs) {
                      return buildPipelineEntry(child.ref, jobs);
                    })
                    .catch(function () {
                      return null;
                    });
                }),
              ).then(function (childEntries) {
                const list = [buildPipelineEntry(encodedProject, res[0])];
                for (const childEntry of childEntries) {
                  if (childEntry) list.push(childEntry);
                }
                _pipelinesCache = { list: list, at: Date.now() };
                _pipelinesPromise = null;
                return list;
              });
            });
            _pipelinesPromise.then(null, function () {
              _pipelinesPromise = null;
            });
            return _pipelinesPromise;
          }

          // Which pipeline does this stage column belong to? Match a job link
          // inside the column against the fetched job ids. Falls back to the
          // parent pipeline only when the column is not inside a child graph.
          function pipelineEntryFor(
            titleEl: HTMLElement,
            list: PipelineEntry[],
          ) {
            const scope =
              qUp(titleEl, SEL.pipelineStageColumn) || titleEl.parentElement;
            const links = qAll(scope, SEL.pipelineJobLink);
            for (const jobLink of links) {
              const m = (jobLink.getAttribute("href") || "").match(
                /\/(?:jobs|builds)\/(\d+)/,
              );
              if (!m) continue;
              const jid = Number(m[1]);
              for (const pipelineEntry of list) {
                if (pipelineEntry.jobIds[jid]) return pipelineEntry;
              }
              return null; // job from a pipeline we didn't fetch (deeper nesting) — don't guess
            }
            if (!qUp(titleEl, SEL.pipelineLinkedGraph)) return list[0];
            return null;
          }

          function manualJobsOf(jobs: Job[]) {
            const manual = [];
            for (const manualJob of jobs) {
              if (manualJob.status === "manual") manual.push(manualJob);
            }
            return manual;
          }

          // Stage name from the column title: prefer the span[title] GitLab renders
          function stageNameFromEl(titleEl: HTMLElement) {
            let nameEl = q(titleEl, "span[title]");
            if (nameEl)
              return (
                nameEl.getAttribute("title") ||
                nameEl.textContent ||
                ""
              ).trim();
            nameEl = q(titleEl, "span");
            return ((nameEl || titleEl).textContent || "").trim();
          }

          const PLAY_SVG =
            '<svg viewBox="0 0 16 16" width="12" height="12"><path fill="currentColor" d="M4.5 3.1c0-.9 1-1.5 1.8-1L13 6.9c.8.5.8 1.7 0 2.2l-6.7 4.8c-.8.5-1.8-.1-1.8-1V3.1z"/></svg>';
          const CHECK_SVG =
            '<svg viewBox="0 0 16 16" width="12" height="12"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M3 8.5l3.5 3.5L13 4.5"/></svg>';

          function playGroup(
            titleEl: HTMLElement,
            stageName: string,
            btn: PlayButton,
          ) {
            if (btn._glBusy) return;
            btn._glBusy = true;
            btn.classList.remove("gl-group-play-error");
            btn.classList.add("gl-group-play-busy");
            getPipelines()
              .then(function (list) {
                if (scope.disposed) return;
                const entry = pipelineEntryFor(titleEl, list);
                if (!entry) throw new Error(msg("groupPlayError"));
                const manual = manualJobsOf(entry.stages[stageName] || []);
                let chain: Promise<unknown> = Promise.resolve();
                let failed = 0;
                manual.forEach(function (job) {
                  chain = chain.then(function () {
                    return api(
                      "POST",
                      "/projects/" +
                        entry.projectRef +
                        "/jobs/" +
                        job.id +
                        "/play",
                    ).catch(function () {
                      failed++;
                    });
                  });
                });
                return chain.then(function () {
                  _pipelinesCache = null;
                  btn.classList.remove("gl-group-play-busy");
                  if (failed > 0 && failed === manual.length) {
                    btn.classList.add("gl-group-play-error");
                    btn.title = msg("groupPlayError");
                    btn._glBusy = false;
                  } else {
                    btn.classList.add("gl-group-play-done");
                    btn.innerHTML = CHECK_SVG;
                    btn.title = failed ? msg("groupPlayError") : "";
                  }
                });
              })
              .catch(function () {
                btn.classList.remove("gl-group-play-busy");
                btn.classList.add("gl-group-play-error");
                btn.title = msg("groupPlayError");
                btn._glBusy = false;
              });
          }

          function injectGroupPlayButtons() {
            if (scope.disposed) return;
            const titles = qAll(document, SEL.pipelineStageTitle);
            if (!titles.length) return;
            getPipelines()
              .then(function (list) {
                if (scope.disposed) return;
                for (const titleEl of titles) {
                  const ourBtn =
                    titleEl.querySelector<PlayButton>(".gl-group-play-btn");
                  const nativeBtn = q(titleEl, SEL.pipelineStageAction);
                  const name = stageNameFromEl(titleEl);
                  const entry = pipelineEntryFor(titleEl, list);
                  const jobs = entry ? entry.stages[name] : null;
                  const manual = jobs ? manualJobsOf(jobs) : [];
                  // Show only while GitLab's own "Run all manual" is gone and manual jobs remain
                  const shouldShow = !nativeBtn && manual.length > 0;

                  if (!shouldShow) {
                    if (ourBtn && !ourBtn._glBusy && ourBtn.parentNode)
                      ourBtn.parentNode.removeChild(ourBtn);
                    continue;
                  }
                  if (ourBtn) {
                    if (!ourBtn._glBusy)
                      ourBtn.title =
                        msg("groupPlayTooltip") + " (" + manual.length + ")";
                    continue;
                  }

                  const btn = document.createElement("button");
                  btn.className = "gl-group-play-btn";
                  btn.type = "button";
                  btn.title =
                    msg("groupPlayTooltip") + " (" + manual.length + ")";
                  btn.setAttribute("aria-label", msg("groupPlayTooltip"));
                  btn.innerHTML = PLAY_SVG;
                  btn.addEventListener(
                    "click",
                    (function (
                      tEl: HTMLElement,
                      stName: string,
                      b: PlayButton,
                    ) {
                      return function (e: MouseEvent) {
                        e.preventDefault();
                        e.stopPropagation();
                        playGroup(tEl, stName, b);
                      };
                    })(titleEl, name, btn),
                  );
                  titleEl.appendChild(btn);
                }
              })
              .catch(function () {});
          }

          let _injectTimer: ReturnType<typeof setTimeout> | undefined;
          function scheduleInject() {
            if (_injectTimer) scope.cancelTimeout(_injectTimer);
            _injectTimer = scope.timeout(function () {
              _injectTimer = undefined;
              injectGroupPlayButtons();
            }, GRAPH_MOUNT_DEBOUNCE_MS);
          }

          // Mutation is "ours" only when it purely adds our button(s) — everything
          // else (incl. Vue re-renders that silently drop our buttons) must re-inject
          function isOwnMutation(m: MutationRecord) {
            if (m.type !== "childList") return false;
            if (m.removedNodes.length || !m.addedNodes.length) return false;
            for (const addedNode of m.addedNodes) {
              const n = addedNode;
              if (!(
                isElement(n) &&
                n.classList &&
                n.classList.contains("gl-group-play-btn")
              ))
                return false;
            }
            return true;
          }

          function startGroupPlay() {
            injectGroupPlayButtons();

            // GitLab polls the graph and re-renders nodes; native stage actions
            // appear/disappear as statuses change. Re-check periodically as a
            // safety net (jobs API is cached, so ~1 request per 10s at most).
            scope.interval(function () {
              if (!document.hidden) scheduleInject();
            }, GRAPH_REFRESH_INTERVAL_MS);

            const target = q(document, SEL.pipelineGraph) || document.body;
            const mo = scope.observer(function (mutations) {
              for (const mutation of mutations) {
                if (isOwnMutation(mutation)) continue;
                scheduleInject();
                return;
              }
            });
            mo.observe(target, { childList: true, subtree: true });
          }

          if (document.readyState === "loading") {
            scope.listen(document, "DOMContentLoaded", startGroupPlay);
          } else {
            startGroupPlay();
          }
        }),
      );
    } catch {
      /* Optional UI may be unavailable. */
    }
  }

  // =========================================================================
}
