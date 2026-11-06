import { reportError } from "../../../shared/lib/errors";
import { GITLAB_API_PREFIX } from "../../../shared/config/gitlab";
import type { ActiveMergeRequest } from "../../../entities/merge-request";
import type { Job, Pipeline } from "../../../entities/pipeline";
import type { MrSettings } from "../../../entities/settings";
import type {
  createMrActions,
  MrActionContext,
} from "../../../features/mr-actions";
import type { Translate } from "../../../shared/i18n";
import { escHtml } from "../../../shared/lib/html";
import type { Lifecycle } from "../../../shared/lib/lifecycle";
// =========================================================================
// Failed Job Quick View
// =========================================================================

const ANSI_COLORS: Record<string, string> = {
  "30": "#555",
  "31": "#e05d44",
  "32": "#3fb950",
  "33": "#d29922",
  "34": "#58a6ff",
  "35": "#bc8cff",
  "36": "#76e4f7",
  "37": "#e6e6e6",
  "90": "#888",
  "91": "#ff7b72",
  "92": "#7ee787",
  "93": "#e3b341",
  "94": "#79c0ff",
  "95": "#d2a8ff",
  "96": "#a5d6ff",
  "97": "#ffffff",
};

const CHEVRON_SVG =
  '<svg viewBox="0 0 16 16" width="12" height="12"><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" d="M3 10l5-5 5 5"/></svg>';
export function createFailedJobView(
  context: MrActionContext,
  api: ReturnType<typeof createMrActions>["api"],
  t: Translate,
  scope: Lifecycle,
  parsePage: () => boolean,
) {
  function ansiToHtml(text: string) {
    // Strip GitLab section markers
    text = text.replace(/section_(start|end):[^\r\n]*/g, "");
    let result = "";
    let open = false;
    let i = 0;
    while (i < text.length) {
      if (text.charCodeAt(i) === 0x1b && text.charAt(i + 1) === "[") {
        const end = text.indexOf("m", i + 2);
        if (end === -1) {
          i++;
          continue;
        }
        const codes = text.substring(i + 2, end).split(";");
        if (open) {
          result += "</span>";
          open = false;
        }
        for (let c = 0; c < codes.length; c++) {
          const color = ANSI_COLORS[codes[c]];
          if (color) {
            result += '<span style="color:' + color + '">';
            open = true;
            break;
          }
          if (codes[c] === "0" || codes[c] === "") {
            break;
          }
          if (codes[c] === "1") {
            result += '<span style="font-weight:700">';
            open = true;
            break;
          }
        }
        i = end + 1;
      } else {
        const ch = text.charAt(i);
        if (ch === "<") result += "&lt;";
        else if (ch === ">") result += "&gt;";
        else if (ch === "&") result += "&amp;";
        else result += ch;
        i++;
      }
    }
    if (open) result += "</span>";
    return result;
  }

  function fetchJobTrace(jobId: number) {
    const url =
      context.origin +
      GITLAB_API_PREFIX +
      "/projects/" +
      context.projectId +
      "/jobs/" +
      jobId +
      "/trace";
    return fetch(url, { credentials: "same-origin", signal: scope.signal })
      .then(function (r) {
        if (!r.ok) return escHtml(t("failedJobTraceError"));
        return r.text().then(function (text) {
          const lines = text.split("\n").filter(function (l) {
            return l.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trim() !== "";
          });
          return ansiToHtml(lines.slice(-50).join("\n"));
        });
      })
      .catch(function () {
        return escHtml(t("failedJobTraceError"));
      });
  }

  function injectFailedJobView(
    mr: ActiveMergeRequest,
    s: MrSettings,
    widgetSection: Element,
  ) {
    if (scope.disposed) return;
    if (s.show_failed_job_view === false) return;
    if (document.querySelector(".gl-mr-actions-failed-jobs")) return;

    function renderForPipeline(pipelineId: number) {
      if (scope.disposed) return;
      api<Job[]>(
        "GET",
        "/projects/" +
          context.projectId +
          "/pipelines/" +
          pipelineId +
          "/jobs?scope[]=failed&per_page=10",
      )
        .then(function (jobs) {
          if (scope.disposed) return;
          if (!jobs || !jobs.length) return;
          if (document.querySelector(".gl-mr-actions-failed-jobs")) return;

          const wrapper = document.createElement("div");
          wrapper.className = "gl-mr-actions-failed-jobs";

          const header = document.createElement("div");
          header.className = "gl-mr-actions-failed-jobs-header";
          header.innerHTML =
            '<span class="gl-mr-actions-failed-jobs-title">' +
            escHtml(t("failedJobsCount", [jobs.length])) +
            "</span>" +
            '<span class="gl-mr-actions-failed-jobs-toggle">' +
            CHEVRON_SVG +
            "</span>";
          wrapper.appendChild(header);

          const list = document.createElement("div");
          list.className = "gl-mr-actions-failed-jobs-list";
          wrapper.appendChild(list);

          header.addEventListener("click", function () {
            const visible = list.style.display !== "none";
            list.style.display = visible ? "none" : "";
            wrapper.classList.toggle("collapsed", visible);
          });

          const displayJobs = jobs.slice(0, 5);
          const tracePromises = displayJobs.map(function (job) {
            return fetchJobTrace(job.id).then(function (trace) {
              return { job: job, trace: trace };
            });
          });

          Promise.all(tracePromises)
            .then(function (results) {
              if (scope.disposed || !parsePage()) return;
              results.forEach(function (r, i) {
                const item = document.createElement("div");
                item.className = "gl-mr-actions-failed-job-item";

                const jobUrl =
                  context.origin +
                  "/" +
                  context.projectPath +
                  "/-/jobs/" +
                  r.job.id;
                const nameRow = document.createElement("div");
                nameRow.className = "gl-mr-actions-failed-job-name";
                nameRow.innerHTML =
                  '<a href="' +
                  escHtml(jobUrl) +
                  '" target="_blank">' +
                  escHtml(r.job.name) +
                  "</a>" +
                  (r.job.stage
                    ? ' <span class="gl-mr-actions-failed-job-stage">' +
                      escHtml(r.job.stage) +
                      "</span>"
                    : "") +
                  '<span class="gl-mr-actions-failed-job-expand">' +
                  CHEVRON_SVG +
                  "</span>";
                item.appendChild(nameRow);

                const trace = document.createElement("pre");
                trace.className = "gl-mr-actions-failed-job-trace";
                trace.innerHTML = r.trace;
                if (i !== 0) {
                  trace.style.display = "none";
                  item.classList.add("collapsed");
                }
                item.appendChild(trace);

                nameRow.addEventListener("click", function (e) {
                  if ((e.target as Element).closest("a")) return;
                  const visible = trace.style.display !== "none";
                  trace.style.display = visible ? "none" : "";
                  item.classList.toggle("collapsed", visible);
                  if (!visible) {
                    requestAnimationFrame(function () {
                      requestAnimationFrame(function () {
                        trace.scrollTop = trace.scrollHeight;
                      });
                    });
                  }
                });

                list.appendChild(item);
              });

              if (jobs.length > 5) {
                const more = document.createElement("div");
                more.className = "gl-mr-actions-failed-jobs-more";
                more.textContent = t("failedJobsMore", [jobs.length - 5]);
                list.appendChild(more);
              }

              widgetSection.appendChild(wrapper);
              requestAnimationFrame(function () {
                const traces = wrapper.querySelectorAll<HTMLElement>(
                  ".gl-mr-actions-failed-job-trace",
                );
                for (let i = 0; i < traces.length; i++) {
                  if (traces[i].style.display !== "none") {
                    traces[i].scrollTop = traces[i].scrollHeight;
                  }
                }
              });
            })
            .catch(reportError);
        })
        .catch(function () {});
    }

    if (mr.head_pipeline && mr.head_pipeline.status === "failed") {
      renderForPipeline(mr.head_pipeline.id);
    } else {
      // GitLab 18.x: head_pipeline may lag or be absent — check pipelines API directly
      api<Pipeline[]>(
        "GET",
        "/projects/" +
          context.projectId +
          "/merge_requests/" +
          context.mrIid +
          "/pipelines?per_page=1",
      )
        .then(function (pipelines) {
          if (
            pipelines &&
            pipelines.length &&
            pipelines[0].status === "failed"
          ) {
            renderForPipeline(pipelines[0].id);
          }
        })
        .catch(function () {});
    }
  }
  return { injectFailedJobView };
}
