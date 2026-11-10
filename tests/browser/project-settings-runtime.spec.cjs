const { test, expect, chromium } = require("@playwright/test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { bundleForTest } = require("../helpers/runtime.cjs");
const messages = require("../../_locales/en/messages.json");
const sha = "a".repeat(40);
let context, worker, extensionId, profile;
const errors = [],
  writes = [];
function commitMarkup() {
  return `<div class="commit"><span class="commit-row-message">AAA-1 BBB-2 Shared work</span><div class="commit-sha-group"><span data-clipboard-text="${sha}">${sha}</span></div></div>`;
}
function pageMarkup() {
  return `<!doctype html><html><head><meta content="GitLab"><meta name="csrf-token" content="fixture"></head><body data-page="projects:merge_requests:show" data-project-id="37"><main><div class="merge-request-details"><div class="detail-page-header"></div><div class="mr-widget"><div class="mr-widget-section"></div></div></div><div class="detail-page-description"></div><div class="notes"></div>${commitMarkup()}<div data-testid="stage-column"><div data-testid="stage-column-title"><span title="test">test</span></div><a href="/team/a/-/jobs/8">Manual job</a></div></main></body></html>`;
}

test.beforeAll(async () => {
  profile = await fs.mkdtemp(
    path.join(os.tmpdir(), "gitlab-project-settings-"),
  );
  const extension = path.resolve("dist");
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  context.on("page", (page) =>
    page.on("pageerror", (error) => errors.push(error.message)),
  );
  await context.route(/^https?:/, async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (request.method() !== "GET")
      writes.push({ method: request.method(), url: url.href });
    if (url.pathname.includes("/api/v4/")) {
      let body = [];
      if (url.pathname.endsWith("/user")) body = { id: 7, username: "fixture" };
      else if (/\/merge_requests\/\d+$/.test(url.pathname))
        body = {
          id: 42,
          iid: 42,
          project_id: 37,
          title: "Fixture MR",
          state: "opened",
          source_branch: "feature",
          target_branch: "main",
          sha,
          source_project_id: 37,
          target_project_id: 37,
          merge_status: "can_be_merged",
        };
      else if (/\/projects\/(37|38)$/.test(url.pathname))
        body = {
          id: Number(url.pathname.split("/").pop()),
          path_with_namespace: url.pathname.endsWith("/38")
            ? "team/b"
            : "team/a",
          merge_method: "merge",
        };
      else if (url.pathname.endsWith("/pipelines/100/jobs"))
        body = [{ id: 8, name: "manual-job", status: "manual", stage: "test" }];
      else if (url.pathname.includes("/repository/files/VERSION"))
        body = { content: Buffer.from("9.8.7").toString("base64") };
      else if (url.pathname.includes("/repository/files/package.json"))
        body = {
          content: Buffer.from('{"version":"1.2.3"}').toString("base64"),
        };
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(body),
        headers: { "x-next-page": "" },
      });
    }
    return route.fulfill({ contentType: "text/html", body: pageMarkup() });
  });
  [worker] = context.serviceWorkers();
  worker ||= await context.waitForEvent("serviceworker");
  extensionId = new URL(worker.url()).host;
});
test.afterAll(async () => {
  await context?.close();
  if (profile) await fs.rm(profile, { recursive: true, force: true });
});
test.afterEach(() => {
  expect(errors).toEqual([]);
  expect(writes).toEqual([]);
});
async function settings(values, run) {
  const previous = await worker.evaluate(() => chrome.storage.sync.get(null));
  try {
    await worker.evaluate(
      (values) =>
        chrome.storage.sync.set({
          language: "en",
          jira_url: "",
          show_ai_review_copy: false,
          show_time_tracker: false,
          btn_rebase_automerge: false,
          btn_ship: false,
          ...values,
        }),
      values,
    );
    await run();
  } finally {
    await worker.evaluate(async (previous) => {
      await chrome.storage.sync.clear();
      await chrome.storage.sync.set(previous);
    }, previous);
  }
}
async function navigate(page, project, suffix) {
  await page.evaluate(
    ({ project, suffix }) => {
      document.body.dataset.projectId = project === "team/a" ? "37" : "38";
      history.pushState({}, "", `/${project}/-/${suffix}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    },
    { project, suffix },
  );
}

test("installed SPA routes restore project layout and review visibility without leaking the previous project", async () => {
  await settings(
    {
      collapse_bars: false,
      hide_right_sidebar: false,
      projectProfiles: {
        "team/a": {
          overrides: {
            collapse_bars: true,
            hide_right_sidebar: true,
            show_ai_review_copy: false,
          },
        },
        "team/b": {
          overrides: {
            collapse_bars: false,
            hide_right_sidebar: false,
            show_ai_review_copy: true,
          },
        },
      },
    },
    async () => {
      const page = await context.newPage();
      try {
        await page.goto("https://gitlab.test/team/a/-/merge_requests/42");
        await expect(page.locator(".gl-mr-ext-collapse-btn")).toHaveCount(1);
        await expect(page.locator("body")).toHaveClass(
          /gl-mr-ext-hide-right-sidebar/,
        );
        await expect(page.locator(".gl-review-launcher")).toHaveCount(0);
        await navigate(page, "team/b", "merge_requests/42");
        await expect(page.locator(".gl-mr-ext-collapse-btn")).toHaveCount(0);
        await expect(page.locator("body")).not.toHaveClass(
          /gl-mr-ext-hide-right-sidebar/,
        );
        await expect(
          page.locator(".gl-review-launcher:not(.gl-review-import-launcher)"),
        ).toHaveCount(1);
        await navigate(page, "team/a", "merge_requests/42");
        await expect(page.locator(".gl-mr-ext-collapse-btn")).toHaveCount(1);
        await expect(page.locator("body")).toHaveClass(
          /gl-mr-ext-hide-right-sidebar/,
        );
        await expect(page.locator(".gl-review-launcher")).toHaveCount(0);
      } finally {
        await page.close();
      }
    },
  );
});

test("installed commits use project cherry-pick options and the legacy version file while unrelated projects inherit globals", async () => {
  await settings(
    {
      show_cherry_pick: true,
      show_commit_version: false,
      cherry_pick_branches: ["release/global"],
      cherry_pick_create_mr: true,
      cherry_pick_smart_fallback: true,
      cherry_pick_bump_version: false,
      projectProfiles: {
        "team/a": {
          versionFile: "VERSION",
          cherry_pick_branches: ["release/project"],
          overrides: {
            show_commit_version: true,
            cherry_pick_create_mr: false,
            cherry_pick_smart_fallback: false,
            cherry_pick_bump_version: true,
          },
        },
        "team/b": { overrides: { show_cherry_pick: false } },
      },
    },
    async () => {
      const page = await context.newPage();
      try {
        await page.goto("https://gitlab.test/team/a/-/commits/main");
        await expect(page.locator(".gl-commit-version-badge")).toHaveText(
          "9.8.7",
        );
        await page.locator(".gl-cherry-pick-btn").click();
        await expect(page.locator(".gl-cherry-pick-branch-name")).toHaveText([
          "release/project",
        ]);
        await expect(
          page.locator(".gl-cherry-pick-mr-checkbox"),
        ).not.toBeChecked();
        await expect(
          page.locator(".gl-cherry-pick-fallback-checkbox"),
        ).not.toBeChecked();
        await expect(
          page.locator(".gl-cherry-pick-bump-checkbox"),
        ).toBeChecked();
        await navigate(page, "team/b", "commits/main");
        await expect(page.locator(".gl-cherry-pick-overlay")).toHaveCount(0);
        await expect(page.locator(".gl-cherry-pick-btn")).toHaveCount(0);
        await expect(page.locator(".gl-commit-version-badge")).toHaveCount(0);
        await navigate(page, "team/no-profile", "commits/main");
        await expect(page.locator(".gl-cherry-pick-btn")).toHaveCount(1);
        await page.locator(".gl-cherry-pick-btn").click();
        await expect(page.locator(".gl-cherry-pick-branch-name")).toHaveText([
          "release/global",
        ]);
        await expect(page.locator(".gl-cherry-pick-mr-checkbox")).toBeChecked();
        await expect(
          page.locator(".gl-cherry-pick-fallback-checkbox"),
        ).toBeChecked();
        await expect(
          page.locator(".gl-cherry-pick-bump-checkbox"),
        ).not.toBeChecked();
      } finally {
        await page.close();
      }
    },
  );
});

test("installed pipeline controls honor each project after SPA navigation", async () => {
  await settings(
    {
      show_group_play: true,
      projectProfiles: {
        "team/a": {
          overrides: { show_group_play: false, collapse_bars: true },
        },
        "team/b": {
          overrides: { show_group_play: true, collapse_bars: false },
        },
      },
    },
    async () => {
      const page = await context.newPage();
      try {
        await page.goto("https://gitlab.test/team/a/-/pipelines/100");
        await expect(page.locator(".gl-mr-ext-collapse-btn")).toHaveCount(1);
        await expect(page.locator(".gl-group-play-btn")).toHaveCount(0);
        await navigate(page, "team/b", "pipelines/100");
        await expect(page.locator(".gl-group-play-btn")).toHaveCount(1);
        await navigate(page, "team/a", "pipelines/100");
        await expect(page.locator(".gl-mr-ext-collapse-btn")).toHaveCount(1);
        await expect(page.locator(".gl-group-play-btn")).toHaveCount(0);
      } finally {
        await page.close();
      }
    },
  );
});

test("popup Jira summary follows the active project, global fallback and an explicitly disabled URL", async () => {
  await settings(
    {
      jira_url: "https://jira.global.test",
      projectProfiles: {
        "team/a": { overrides: { jira_url: "https://jira.project.test/jira" } },
      },
    },
    async () => {
      const page = await context.newPage();
      try {
        // Only active-tab selection is a fixture; preferences/updates use real extension storage.
        await page.addInitScript(() => {
          chrome.tabs.query = (_query, reply) =>
            reply([{ url: "https://gitlab.test/team/a/-/commit/abcdef123" }]);
        });
        await page.goto(`chrome-extension://${extensionId}/quick-popup.html`);
        await expect(page.locator(".jira-access-summary a")).toHaveAttribute(
          "href",
          "https://jira.project.test/jira",
        );
        await worker.evaluate(() =>
          chrome.storage.sync.set({ projectProfiles: { "team/a": {} } }),
        );
        await expect(page.locator(".jira-access-summary a")).toHaveAttribute(
          "href",
          "https://jira.global.test",
        );
        await worker.evaluate(() =>
          chrome.storage.sync.set({
            projectProfiles: { "team/a": { overrides: { jira_url: "" } } },
          }),
        );
        await expect(page.locator(".jira-access-summary")).toHaveCount(0);
      } finally {
        await page.close();
      }
    },
  );
});

test("commit Jira badges select project hosts, ticket patterns and empty field overrides without writes", async ({
  page,
}) => {
  await page.route(/^https?:/, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<html><body></body></html>",
    }),
  );
  await page.goto("https://gitlab.test/team/a/-/commits/main");
  await page.evaluate(
    ({ messages, markup }) => {
      window.pending = [];
      window.sent = [];
      window.chrome = {
        runtime: {
          id: "fixture",
          sendMessage: (message, callback) => {
            sent.push(message);
            pending.push({ message, callback });
          },
        },
        i18n: { getMessage: (key) => messages[key]?.message || key },
        storage: {
          sync: {
            get: (defaults, reply) =>
              reply({
                ...defaults,
                jira_url: "https://jira.global.test",
                commits_jira_field: "status",
                projectProfiles: {
                  "team/a": {
                    overrides: {
                      jira_url: "https://jira.a.test",
                      jira_ticket_regex: "AAA-\\d+",
                    },
                  },
                  "team/b": {
                    overrides: {
                      jira_url: "https://jira.b.test",
                      jira_ticket_regex: "BBB-\\d+",
                    },
                  },
                  "team/c": { overrides: { commits_jira_field: "" } },
                },
              }),
          },
        },
      };
      document.body.innerHTML = markup;
      window.markup = markup;
    },
    { messages, markup: commitMarkup() },
  );
  for (const [entry, name] of [
    ["src/shared/lib/lifecycle/index.ts", "Lifecycle"],
    ["src/entities/jira-issue/index.ts", "Jira"],
    ["src/widgets/commit-actions/ui/jira.ts", "Commits"],
  ])
    await page.addScriptTag({
      content: bundleForTest(entry, { globalName: name }),
    });
  await page.evaluate(() => {
    window.state = Jira.createJiraState();
    window.scope = Lifecycle.createLifecycle();
    Commits.startCommitJira(state, () => {}, scope);
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        pending.map((item) => ({
          url: item.message.jiraUrl,
          tickets: item.message.tickets,
        })),
      ),
    )
    .toEqual([{ url: "https://jira.a.test", tickets: ["AAA-1"] }]);
  await page.evaluate(() =>
    pending.shift().callback({ values: { "AAA-1": { values: ["Status A"] } } }),
  );
  await expect(page.locator(".gl-commit-jira-badge")).toHaveText("Status A");
  await page.evaluate(() => {
    scope.dispose();
    history.replaceState({}, "", "/team/b/-/commits/main");
    document.body.innerHTML = markup;
    window.scope = Lifecycle.createLifecycle();
    Commits.startCommitJira(state, () => {}, scope);
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        pending.map((item) => ({
          url: item.message.jiraUrl,
          tickets: item.message.tickets,
        })),
      ),
    )
    .toEqual([{ url: "https://jira.b.test", tickets: ["BBB-2"] }]);
  await page.evaluate(() =>
    pending.shift().callback({ values: { "BBB-2": { values: ["Status B"] } } }),
  );
  await expect(page.locator(".gl-commit-jira-badge")).toHaveText("Status B");
  await page.evaluate(() => {
    scope.dispose();
    history.replaceState({}, "", "/team/c/-/commits/main");
    document.body.innerHTML = markup;
    window.scope = Lifecycle.createLifecycle();
    Commits.startCommitJira(state, () => {}, scope);
  });
  await expect(page.locator(".gl-commit-jira-badge")).toHaveCount(0);
  expect(await page.evaluate(() => sent.map((item) => item.type))).toEqual([
    "fetch-jira-field-values",
    "fetch-jira-field-values",
  ]);
  await page.evaluate(() => scope.dispose());
});

test("MR detail clears Jira authentication failures and caches when the next project uses another host", async ({
  page,
}) => {
  await page.route(/^https?:/, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<html><body><div class="detail-page-header"><h1 class="title">SAME-1 Shared ticket key</h1></div></body></html>',
    }),
  );
  await page.goto("https://gitlab.test/team/a/-/merge_requests/42");
  await page.evaluate(() => {
    window.pending = [];
    window.chrome = {
      runtime: {
        id: "fixture",
        sendMessage: (message, callback) => pending.push({ message, callback }),
      },
      i18n: { getMessage: (key) => key },
      storage: {
        sync: {
          get: (defaults, reply) =>
            reply({
              ...defaults,
              projectProfiles: {
                "team/a": { overrides: { jira_url: "https://jira.a.test" } },
                "team/b": { overrides: { jira_url: "https://jira.b.test" } },
              },
            }),
        },
      },
    };
  });
  for (const [entry, name] of [
    ["src/shared/lib/lifecycle/index.ts", "Lifecycle"],
    ["src/entities/jira-issue/index.ts", "Jira"],
    ["src/widgets/mr-list/index.ts", "List"],
  ])
    await page.addScriptTag({
      content: bundleForTest(entry, { globalName: name }),
    });
  await page.evaluate(() => {
    window.state = Jira.createJiraState();
    window.scope = Lifecycle.createLifecycle();
    List.startMrList(state, () => {}, true, scope);
  });
  expect(await page.evaluate(() => pending[0].message.jiraUrl)).toBe(
    "https://jira.a.test",
  );
  await page.evaluate(() => {
    pending.shift().callback({
      statuses: { _authError: 401 },
      _failure: { _error: "401", _errorKind: "auth", _httpStatus: 401 },
    });
    state.cache = { "SAME-1": { name: "Stale A", ts: Date.now() } };
    state.myselfCache = { "https://jira.a.test": { name: "old-user" } };
  });
  await expect(page.getByRole("alert")).toContainText("jiraErrorAuth");
  await page.evaluate(() => {
    scope.dispose();
    history.replaceState({}, "", "/team/b/-/merge_requests/42");
    window.scope = Lifecycle.createLifecycle();
    List.startMrList(state, () => {}, true, scope);
  });
  await expect
    .poll(() =>
      page.evaluate(() => pending.map((item) => item.message.jiraUrl)),
    )
    .toEqual(["https://jira.b.test"]);
  expect(
    await page.evaluate(() => ({
      authFailed: state.authFailed,
      cache: state.cache,
      myselfCache: state.myselfCache,
    })),
  ).toEqual({ authFailed: false, cache: {}, myselfCache: {} });
  await page.evaluate(() =>
    pending.shift().callback({
      statuses: { "SAME-1": { name: "Status B", categoryKey: "done" } },
    }),
  );
  await expect(page.locator(".gl-jira-badge")).toHaveText("Status B");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.evaluate(() => scope.dispose());
});

test("Jira sidebar uses per-project quick actions and an empty list suppresses global actions", async ({
  page,
}) => {
  await page.route(/^https?:/, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<html><body></body></html>",
    }),
  );
  await page.goto("https://gitlab.test/team/a/-/merge_requests/42");
  await page.evaluate(() => {
    window.pending = [];
    window.sent = [];
    window.chrome = {
      runtime: {
        id: "fixture",
        sendMessage: (message, callback) => {
          sent.push(message);
          pending.push({ message, callback });
        },
      },
      i18n: { getMessage: (key) => key },
      storage: {
        sync: {
          get: (defaults, reply) =>
            reply({
              ...defaults,
              jiraQuickActions: [
                { label: "Global action", assignee: "global-user" },
              ],
              projectProfiles: {
                "team/a": {
                  overrides: {
                    jiraQuickActions: [
                      { label: "Project action", assignee: "project-user" },
                    ],
                  },
                },
                "team/b": { overrides: { jiraQuickActions: [] } },
              },
            }),
        },
      },
    };
    window.issue = (key) => ({
      key,
      summary: key,
      status: "Open",
      statusCategoryKey: "new",
      description: "",
      assignee: "",
      reporter: "",
      priority: "",
      type: "",
      created: "",
      updated: "",
      resolution: "",
      epicLink: "",
      sprint: "",
      labels: [],
      attachments: {},
      attachmentList: [],
      components: [],
      versions: [],
      fixVersions: [],
    });
    window.replyIssue = () => {
      const index = pending.findIndex(
        (item) => item.message.type === "fetch-jira-issue",
      );
      pending.splice(index, 1)[0].callback(issue("SAME-1"));
    };
  });
  for (const [entry, name] of [
    ["src/shared/lib/lifecycle/index.ts", "Lifecycle"],
    ["src/entities/jira-issue/index.ts", "Jira"],
    ["src/widgets/jira-panel/index.ts", "Panel"],
  ])
    await page.addScriptTag({
      content: bundleForTest(entry, { globalName: name }),
    });
  await page.evaluate(() => {
    window.state = Jira.createJiraState();
    window.scope = Lifecycle.createLifecycle();
    window.panel = Panel.createJiraPanel(state, scope);
    panel.openJiraSidebar("SAME-1", "https://jira.a.test");
    replyIssue();
  });
  await expect(page.locator(".gl-jira-sidebar-quick-action")).toHaveText(
    "⚡ Project action",
  );
  await page.evaluate(() => {
    scope.dispose();
    pending.length = 0;
    history.replaceState({}, "", "/team/b/-/merge_requests/42");
    window.scope = Lifecycle.createLifecycle();
    window.panel = Panel.createJiraPanel(state, scope);
    panel.openJiraSidebar("SAME-1", "https://jira.b.test");
    replyIssue();
  });
  await expect(page.locator(".gl-jira-sidebar")).toHaveCount(1);
  await expect(page.locator(".gl-jira-sidebar-quick-action")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      sent.every((message) => message.type.startsWith("fetch-jira-")),
    ),
  ).toBe(true);
  await page.evaluate(() => scope.dispose());
});

test("project commit badges read extensionless, text, JSON and TOML version files consistently", async ({
  page,
}) => {
  const fixtures = [
    { file: "VERSION", field: "version", content: "9.8.7\n" },
    { file: "VERSION.TEXT", field: "version", content: "9.8.7\n" },
    {
      file: "package.JSON",
      field: "release.version",
      content: '{"release":{"version":"9.8.7"}}',
    },
    {
      file: "pyproject.TOML",
      field: "project.version",
      content: '[project]\nversion = "9.8.7"\n',
    },
  ];
  const calls = [];
  let current;
  await page.route(/^https?:/, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("/api/v4/")) {
      calls.push({ path: url.pathname, method: route.request().method() });
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          content: Buffer.from(current.content).toString("base64"),
        }),
      });
    }
    return route.fulfill({
      contentType: "text/html",
      body: `<html><body>${commitMarkup()}</body></html>`,
    });
  });
  const source = bundleForTest("src/widgets/commit-actions/ui/versions.ts", {
    globalName: "Versions",
  });
  for (const fixture of fixtures) {
    current = fixture;
    await page.goto("https://gitlab.test/team/a/-/commits/main");
    await page.evaluate((fixture) => {
      window.chrome = {
        runtime: { id: "fixture" },
        storage: {
          sync: {
            get: (defaults, reply) =>
              reply({
                ...defaults,
                projectProfiles: {
                  "team/a": {
                    versionFile: fixture.file,
                    versionPath: fixture.field,
                    overrides: { show_commit_version: true },
                  },
                },
              }),
          },
          local: {
            get: (defaults, reply) => reply(defaults),
            set: (_patch, reply) => reply(),
          },
        },
      };
    }, fixture);
    await page.addScriptTag({
      content: source + "\nVersions.startCommitVersions();",
    });
    await expect(page.locator(".gl-commit-version-badge")).toHaveText("9.8.7");
    await expect(page.locator(".gl-commit-version-badge")).toHaveAttribute(
      "title",
      fixture.file,
    );
    expect(calls.at(-1)).toEqual({
      path: `/api/v4/projects/team%2Fa/repository/files/${fixture.file}`,
      method: "GET",
    });
  }
});
