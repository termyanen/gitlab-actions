// Generate public illustrations from fictional data only; never read old images.
// Run explicitly: node tests/fixtures/capture-public-screenshots.cjs
const path = require("node:path");
const root = path.resolve(__dirname, "../..");
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(
  root,
  "node_modules/.cache/ms-playwright",
);
const { chromium } = require("@playwright/test");
const { bundleForTest } = require("../helpers/runtime.cjs");
const messages = require("../../_locales/en/messages.json");
(async () => {
  const browser = await chromium.launch({
    channel: "chromium",
    headless: true,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route(/^https?:/, (route) => route.abort());
    const base =
      '<html class="gl-actions-host"><head><style>body{margin:0;font:14px Arial,sans-serif;color:#333;background:#fff}main{padding:40px;width:800px;box-sizing:border-box}h1{font-size:26px}article{padding:22px 0;border-bottom:1px solid #ddd}article p{margin:12px 0 0;color:#737278}a{color:#1f75cb;text-decoration:none}.demo{color:#737278;font-size:12px;margin-bottom:24px}</style></head><body>';
    await page.setContent(
      base +
        '<main><div class="demo">DEMO DATA · example.test</div><h1>Merge requests</h1><p>Open · 3</p><article><a>PROJ-101 Improve search results</a> <span class="gl-jira-badge jira-progress">IN PROGRESS</span><p>!42 · feature/search → main · Demo Developer</p></article><article><a>PROJ-102 Add keyboard navigation</a> <span class="gl-jira-badge jira-qa">IN QA</span><p>!43 · feature/navigation → main · Demo Reviewer</p></article><article><a>PROJ-103 Update documentation</a> <span class="gl-jira-badge jira-done">DONE</span><p>!44 · docs/getting-started → main · Demo Developer</p></article></main><div class="gl-jira-sidebar"><div class="gl-jira-sidebar-header"><a class="gfm gfm-issue">PROJ-101</a><button class="gl-jira-sidebar-close">×</button></div><div class="gl-jira-sidebar-body"></div></div></body></html>',
    );
    await page.addStyleTag({ path: path.join(root, "content.css") });
    await page.addScriptTag({
      content: bundleForTest("src/widgets/jira-panel/ui/content.ts", {
        globalName: "JiraContent",
      }),
    });
    await page.evaluate((messages) => {
      window.chrome = {
        i18n: { getMessage: (key) => messages[key]?.message || key },
      };
      const render = JiraContent.createJiraSidebarContent({
        fetchAndRenderJiraComments: (sidebar) => {
          sidebar.querySelector("#gl-jira-sidebar-comments-list").innerHTML =
            '<div class="gl-jira-sidebar-comments-empty">No comments yet</div>';
          sidebar.querySelector(
            "#gl-jira-sidebar-comments-header",
          ).textContent = "COMMENTS (0)";
        },
        wireJiraCommentForm: () => {},
        wireJiraCommentDelete: () => {},
      });
      render(
        document.querySelector(".gl-jira-sidebar"),
        {
          key: "PROJ-101",
          summary: "Improve search results",
          status: "In Progress",
          statusCategoryKey: "indeterminate",
          description:
            "Demo issue for the public extension screenshots.\n\n* Improve search ranking\n* Add keyboard navigation",
          assignee: "Demo Developer",
          reporter: "Demo Reviewer",
          priority: "Medium",
          type: "Task",
          created: "",
          updated: "",
          labels: ["demo", "search"],
          attachments: {},
          attachmentList: [],
          components: ["Web app"],
          versions: [],
          fixVersions: ["2.0.1"],
          resolution: "",
          epicLink: "PROJ-100",
          sprint: "Demo sprint",
        },
        "https://jira.example.test",
      );
    }, messages);
    await page.screenshot({
      path: path.join(root, "docs/screenshots/2-jira-badges-and-sidebar.png"),
      animations: "disabled",
    });
    await page.setContent(
      base +
        '<main><div class="demo">DEMO DATA · example.test</div><h1>Background job chains</h1><p>Build, test and deploy with progress tracking.</p></main></body></html>',
    );
    await page.addStyleTag({ path: path.join(root, "content.css") });
    await page.addScriptTag({
      content: bundleForTest("src/widgets/task-tracker/index.ts", {
        globalName: "Tracker",
      }),
    });
    await page.evaluate(() => {
      const tracker = Tracker.createTaskTracker();
      tracker.updateTrackerItem(
        "demo-build",
        ["Build", "Test"],
        "done",
        null,
        "!42 Improve search results",
      );
      tracker.updateTrackerItem(
        "demo-deploy",
        ["Build", "Deploy preview"],
        "running: Deploy preview",
        null,
        "!43 Add keyboard navigation",
      );
    });
    await page
      .locator(".gl-mr-actions-tracker")
      .screenshot({
        path: path.join(root, "docs/screenshots/4-tracker.png"),
        animations: "disabled",
      });
    await page.setViewportSize({ width: 1200, height: 630 });
    await page.setContent(
      "<html><head><style>body{margin:0;padding:70px;box-sizing:border-box;font:24px Arial,sans-serif;background:#f7f6fc;color:#25222c;border-top:16px solid #6b4fbb;height:630px}h1{font-size:64px;margin:45px 0 22px}p{line-height:1.5;color:#62606c}section{display:flex;gap:20px;margin-top:45px}section span{background:white;border:1px solid #dcdcde;border-radius:12px;padding:22px}footer{font-size:18px;color:#62606c;margin-top:40px}</style></head><body><h1>GitLab MR Actions</h1><p>Merge requests · Jira · CI/CD · AI review</p><section><span>Review</span><span>Automate</span><span>Customize</span></section><footer>Open source · 27 interface languages</footer></body></html>",
    );
    await page.screenshot({
      path: path.join(root, "docs/og-image.png"),
      animations: "disabled",
    });
    if (errors.length) throw new Error(errors.join("\n"));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
