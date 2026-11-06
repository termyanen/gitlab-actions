import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

// All network traffic is fulfilled locally. Run against two builds with the
// same browser and workload; timings include the deliberate list debounce.
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.resolve(
  "node_modules/.cache/ms-playwright",
);
const { chromium } = await import("@playwright/test");
const args = process.argv.slice(2).filter((arg) => arg !== "--check");
const extension = path.resolve(args[0] || "dist");
const output = path.resolve(args[1] || ".reports/runtime-performance.json");
const profile = await mkdtemp(
  path.join(os.tmpdir(), "gitlab-runtime-profile-"),
);
const rows = 20;
const batches = 3;
const cycles = 20;
const errors = [];
const budgets = { nodes: 600, listeners: 5, heapBytes: 2 * 1024 * 1024 };
function growth(first, last) {
  return {
    nodes: last.nodes - first.nodes,
    listeners: last.jsEventListeners - first.jsEventListeners,
    heapBytes: last.heapBytes - first.heapBytes,
    scriptSeconds: last.scriptSeconds - first.scriptSeconds,
    taskSeconds: last.taskSeconds - first.taskSeconds,
  };
}
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  await context.route(/^https?:/, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("/api/v4/")) {
      const body = url.pathname.endsWith("/user")
        ? { id: 7, username: "tester" }
        : url.pathname.endsWith("/approvals")
          ? { approved_by: [{ user: { username: "tester", name: "Tester" } }] }
          : /\/merge_requests\/\d+$/.test(url.pathname)
            ? {
                id: 42,
                iid: 42,
                project_id: 37,
                title: "Fixture MR",
                state: "opened",
                source_branch: "feature",
                target_branch: "main",
                sha: "a".repeat(40),
                source_project_id: 37,
                target_project_id: 37,
                merge_status: "can_be_merged",
              }
            : url.pathname.endsWith("/projects/37")
              ? {
                  id: 37,
                  path_with_namespace: "team/repo",
                  merge_method: "merge",
                }
              : [];
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    }
    return route.fulfill({
      contentType: "text/html",
      body: /\/merge_requests\/\d+$/.test(url.pathname)
        ? '<!doctype html><meta content="GitLab"><meta name="csrf-token" content="fixture"><body data-page="projects:merge_requests:show" data-project-id="37"><main><div class="merge-request-details"><div class="detail-page-header"></div><div class="mr-widget"><div class="mr-widget-section"></div></div></div><div class="detail-page-description"></div><div class="notes"></div></main></body>'
        : '<!doctype html><meta content="GitLab"><body data-page="projects:merge_requests:index" data-project-id="37"><ul class="issuable-list"></ul></body>',
    });
  });
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  await worker.evaluate(() =>
    chrome.storage.sync.set({ show_approval_badge: true }),
  );
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  const started = performance.now();
  await page.goto("https://gitlab.test/team/repo/-/merge_requests");
  async function replaceRows() {
    await page.evaluate((rows) => {
      document.querySelector(".issuable-list").innerHTML = Array.from(
        { length: rows },
        (_, i) =>
          `<li class="merge-request"><span class="merge-request-title-text"><a href="/team/repo/-/merge_requests/${42 + i}">MR ${i}</a></span><ul class="controls">${i % 2 ? "" : '<li><span data-testid="mr-approvals" title="Native"><span class="gl-badge-content">Approved</span></span></li>'}</ul></li>`,
      ).join("");
    }, rows);
    await page.waitForFunction(
      (rows) =>
        document.querySelectorAll(".gl-mr-ext-approval-done").length === rows,
      rows,
    );
  }
  await replaceRows();
  const startupMs = performance.now() - started;
  for (let i = 0; i < 5; i++) await replaceRows();
  async function sample() {
    // Two collections with an event-loop turn make transient DOM wrappers less
    // noisy. CDP's counters cover the entire renderer, including isolated worlds.
    await cdp.send("HeapProfiler.collectGarbage");
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
    await cdp.send("HeapProfiler.collectGarbage");
    const metrics = Object.fromEntries(
      (await cdp.send("Performance.getMetrics")).metrics.map(
        ({ name, value }) => [name, value],
      ),
    );
    return {
      ...(await cdp.send("Memory.getDOMCounters")),
      heapBytes: metrics.JSHeapUsedSize,
      scriptSeconds: metrics.ScriptDuration,
      taskSeconds: metrics.TaskDuration,
    };
  }
  const samples = [await sample()];
  const latencies = [];
  for (let batch = 0; batch < batches; batch++) {
    for (let i = 0; i < cycles; i++) {
      const start = performance.now();
      await replaceRows();
      latencies.push(performance.now() - start);
    }
    samples.push(await sample());
  }
  latencies.sort((a, b) => a - b);
  const first = samples[0],
    last = samples.at(-1);
  await page.goto("https://gitlab.test/team/repo/-/merge_requests/42");
  async function dialogNavigationCycle() {
    await page
      .locator(".gl-review-launcher:not(.gl-review-import-launcher)")
      .click();
    await page.locator(".gl-review-dialog").waitFor();
    await page.keyboard.press("Escape");
    await page.locator(".gl-review-dialog").waitFor({ state: "detached" });
    await page.locator(".gl-review-import-launcher").click();
    await page.locator(".gl-review-import-dialog").waitFor();
    await page.keyboard.press("Escape");
    await page.locator(".gl-review-dialog").waitFor({ state: "detached" });
    await page.evaluate(() => {
      history.pushState({}, "", "/team/repo/-/tree/main");
      dispatchEvent(new PopStateEvent("popstate"));
    });
    await page.locator(".gl-mr-actions-ext").waitFor({ state: "detached" });
    await page.evaluate(() => {
      history.pushState({}, "", "/team/repo/-/merge_requests/42");
      dispatchEvent(new PopStateEvent("popstate"));
    });
    await page.locator(".gl-mr-actions-ext").waitFor();
  }
  for (let i = 0; i < 3; i++) await dialogNavigationCycle();
  const dialogSamples = [await sample()];
  for (let batch = 0; batch < 2; batch++) {
    for (let i = 0; i < 10; i++) await dialogNavigationCycle();
    dialogSamples.push(await sample());
  }
  const dialogNavigation = {
    warmupCycles: 3,
    cycles: 20,
    samples: dialogSamples,
    growth: growth(dialogSamples[0], dialogSamples.at(-1)),
  };
  const report = {
    extension,
    chromium: context.browser().version(),
    workload: { rows, cycles: batches * cycles, warmupCycles: 5 },
    startupMs,
    latencyMs: {
      median: latencies[Math.floor(latencies.length / 2)],
      p95: latencies[Math.floor(latencies.length * 0.95)],
    },
    samples,
    growth: growth(first, last),
    dialogNavigation,
    budgets,
    errors,
  };
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  if (errors.length) process.exitCode = 1;
  if (process.argv.includes("--check")) {
    for (const scenario of [report, dialogNavigation]) {
      for (const [metric, budget] of Object.entries(budgets)) {
        if (scenario.growth[metric] > budget) {
          console.error(
            `Resource budget exceeded: ${metric} ${scenario.growth[metric]} > ${budget}`,
          );
          process.exitCode = 1;
        }
      }
    }
  }
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
