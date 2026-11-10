const { test, expect, chromium } = require("@playwright/test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
let context, profile, worker, extensionId;
const errors = [];

test.beforeAll(async () => {
  profile = await fs.mkdtemp(path.join(os.tmpdir(), "gitlab-react-lifecycle-"));
  const extension = path.resolve(__dirname, "../../dist");
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
  await context.route(/^https?:/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>Local fixture</title>",
    }),
  );
  await context.addInitScript(() => {
    if (location.protocol !== "chrome-extension:") return;
    // Observe actual Chrome event registration without replacing event delivery.
    // Retained callbacks below deliberately simulate callbacks queued before teardown.
    window.__reactLifecycle = { counts: {}, callbacks: [] };
    for (const [name, event] of [
      ["storage", chrome.storage.onChanged],
      ["permissionAdded", chrome.permissions.onAdded],
      ["permissionRemoved", chrome.permissions.onRemoved],
    ]) {
      const active = new Set();
      const add = event.addListener.bind(event),
        remove = event.removeListener.bind(event);
      window.__reactLifecycle.counts[name] = 0;
      event.addListener = (callback) => {
        active.add(callback);
        window.__reactLifecycle.counts[name] = active.size;
        window.__reactLifecycle.callbacks.push({ name, callback });
        return add(callback);
      };
      event.removeListener = (callback) => {
        active.delete(callback);
        window.__reactLifecycle.counts[name] = active.size;
        return remove(callback);
      };
    }
  });
  worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  extensionId = new URL(worker.url()).host;
  await worker.evaluate(() =>
    chrome.storage.sync.set({
      language: "en",
      sound_enabled: false,
      jira_url: "https://jira.fixture.test",
      projectProfiles: {
        "team/lifecycle": { buttons: {}, buttonOrder: [], customJobs: [] },
      },
    }),
  );
});
test.afterAll(async () => {
  if (context) await context.close();
  if (profile) await fs.rm(profile, { recursive: true, force: true });
});

for (const [surface, file, root, ready] of [
  ["popup", "quick-popup.html", "popupRoot", "sound_enabled"],
  ["settings", "popup.html", "settingsRoot", "exportSettings"],
]) {
  test(`${surface} keeps subscriptions bounded across renders and releases queued callbacks on pagehide`, async () => {
    const page = await context.newPage();
    try {
      await page.goto(`chrome-extension://${extensionId}/${file}`);
      await expect(page.locator("#" + ready)).toBeEnabled();
      if (surface === "popup") await expect(page.locator(".jira-access-summary")).toBeVisible();
      const before = await page.evaluate(() => window.__reactLifecycle.counts);
      expect(before.storage).toBeGreaterThan(0);
      for (let cycle = 0; cycle < 10; cycle++) {
        if (surface === "popup") {
          await page.locator("#sound_enabled").click();
          await expect(page.locator("#sound_enabled")).toBeEnabled();
          const language = cycle % 2 ? "en" : "ru";
          await worker.evaluate(
            (language) => chrome.storage.sync.set({ language }),
            language,
          );
          await expect(page.locator("html")).toHaveAttribute("lang", language);
          // The document language changes before the packaged catalogue resolves.
          // Wait for the translated UI to remount before counting its subscriptions.
          const messages = require(`../../_locales/${language}/messages.json`);
          await expect(page.locator("#sound_enabled")).toHaveAccessibleName(
            messages.soundNotifications.message,
          );
        } else {
          for (const category of ["jira", "ai", "general", "actions"])
            await page
              .locator(`#settingsNav [data-category="${category}"]`)
              .click();
          await page.locator("#profileScope").selectOption("team/lifecycle");
          await expect(page.locator("#profileVersionStrategy")).toBeAttached();
          await page.locator("#profileScope").selectOption("default");
          await expect(page.locator("#versionStrategy")).toBeAttached();
        }
        await expect
          .poll(() => page.evaluate(() => window.__reactLifecycle.counts))
          .toEqual(before);
      }
      await page.evaluate(() =>
        dispatchEvent(new PageTransitionEvent("pagehide")),
      );
      await expect
        .poll(() => page.evaluate(() => window.__reactLifecycle.counts))
        .toEqual({ storage: 0, permissionAdded: 0, permissionRemoved: 0 });
      await expect(page.locator("#" + root)).toBeEmpty();
      await page.evaluate(() => {
        for (const { name, callback } of window.__reactLifecycle.callbacks) {
          if (name === "storage")
            callback(
              {
                sound_enabled: { newValue: true },
                language: { newValue: "ru" },
              },
              "sync",
            );
          else callback({ origins: ["https://jira.fixture.test/*"] });
        }
      });
      await expect(page.locator("#" + root)).toBeEmpty();
      expect(await page.evaluate(() => window.__reactLifecycle.counts)).toEqual(
        { storage: 0, permissionAdded: 0, permissionRemoved: 0 },
      );
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  });
}
