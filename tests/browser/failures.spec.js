import { test, expect } from "@playwright/test";

async function expectFailure(page) {
  await page.goto("/");
  await expect(page.locator("#result-badge")).toHaveText("执行错误", { timeout: 15000 });
  await expect(page.locator("#halt-message")).not.toBeEmpty();
  for (const button of ["run", "pause", "single-step", "reset"]) {
    await expect(page.locator(`#${button}`)).toBeDisabled();
  }
}

for (const kind of ["http", "network", "json", "incomplete"]) {
  test(`machine loading failure: ${kind}`, async ({ page }) => {
    await page.route("**/api/machines", (route) => {
      if (kind === "network") return route.abort();
      return route.fulfill({ status: kind === "http" ? 503 : 200, contentType: "application/json",
        body: kind === "json" ? "not json" : '{"machines": []}' });
    });
    await expectFailure(page);
  });
}

test("Worker construction failure is visible", async ({ page }) => {
  await page.addInitScript(() => { window.Worker = class { constructor() { throw new Error("Worker unavailable"); } }; });
  await expectFailure(page);
});

test("malformed machine metadata is reported before drawing", async ({ page }) => {
  await page.route("**/api/machines", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    delete data.machines[0].theoretical_steps;
    await route.fulfill({ json: data });
  });
  await expectFailure(page);
});

test("Worker module failure is visible", async ({ page }) => {
  await page.route("**/simulation-worker.js", (route) => route.abort());
  await expectFailure(page);
});

test("silent Worker startup times out", async ({ page }) => {
  await page.addInitScript(() => { window.Worker = class { postMessage() {} terminate() {} }; });
  await expectFailure(page);
  await expect(page.locator("#halt-message")).toContainText("超时");
});

test("invalid transition stops execution; reset and machine switching still work", async ({ page }) => {
  await page.route("**/api/machines", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.machines.find((machine) => machine.id === "busy_beaver_3").transitions.A[0].direction = "invalid";
    await route.fulfill({ json: data });
  });
  await page.goto("/");
  await page.click("#single-step");
  await expect(page.locator("#halt-message")).toContainText("无效转移");
  await expect(page.locator("#steps")).toHaveText("0");
  await expect(page.locator("#ones")).toHaveText("0");
  await expect(page.locator("#run")).toBeDisabled();
  await expect(page.locator("#single-step")).toBeDisabled();
  await page.click("#reset");
  await expect(page.locator("#result-badge")).toHaveText("尚未运行");
  await page.selectOption("#machine-select", "busy_beaver_2");
  await page.click("#single-step");
  await expect(page.locator("#steps")).toHaveText("1");
});
