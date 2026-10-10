import { test, expect } from "@playwright/test";

const number = (text) => Number(text.replaceAll(",", ""));
const count = async (page) => number(await page.locator("#steps").innerText());
const status = (page) => page.locator("#result-badge");

async function open(page) {
  await page.goto("/");
  await expect(page.locator("#single-step")).toBeEnabled();
}

async function choose(page, states) {
  await page.selectOption("#machine-select", `busy_beaver_${states}`);
  await expect(page.locator("#single-step")).toBeEnabled();
  await expect(page.locator("#steps")).toHaveText("0");
}

async function steps(page, n) {
  const before = await count(page);
  await page.evaluate((n) => {
    for (let i = 0; i < n; i++) document.querySelector("#single-step").click();
  }, n);
  await expect.poll(() => count(page)).toBe(before + n);
}

async function comparePython(page, request, machine) {
  const current = await count(page);
  const response = await request.post("/api/simulate", { data: { machine, max_steps: current, trace_limit: 200 } });
  const expected = await response.json();
  const actual = await page.evaluate(() => ({
    state: document.querySelector("#state").textContent,
    head: Number(document.querySelector("#head").textContent),
    ones: Number(document.querySelector("#ones").textContent.replaceAll(",", "")),
    cells: [...document.querySelectorAll("#tape .cell")].map((cell) => ({
      position: Number(cell.dataset.position), value: Number(cell.dataset.value), head: cell.classList.contains("head"),
    })),
  }));
  expect(actual.state).toBe(expected.state);
  expect(actual.head).toBe(expected.head_position);
  expect(actual.ones).toBe(expected.ones);
  expect(actual.cells.map((cell) => cell.position)).toEqual(Array.from({ length: 25 }, (_, i) => expected.head_position - 12 + i));
  expect(Object.fromEntries(actual.cells.map((cell) => [cell.position, cell.value]))).toEqual(expected.tape_window);
  expect(actual.cells.filter((cell) => cell.head).map((cell) => cell.position)).toEqual([actual.head]);
  await expect(page.locator("#trace li")).toHaveCount(Math.min(current, 200));
}

test("blank defaults, consecutive steps match Python, halt, reset and switch", async ({ page, request }) => {
  await open(page);
  await expect(page.locator("#machine-select")).toHaveValue("busy_beaver_3");
  await expect(page.locator("#max-steps")).toHaveValue("1000");
  await expect(page.locator("#speed-mode")).toHaveValue("auto");
  await expect(page.locator("#speed")).toHaveValue("1000");
  await expect(status(page)).toHaveAttribute("data-status", "idle");
  await comparePython(page, request, "busy_beaver_3");
  for (let i = 1; i <= 14; i++) {
    await page.click("#single-step");
    await expect.poll(() => count(page)).toBe(i);
    await comparePython(page, request, "busy_beaver_3");
  }
  await expect(status(page)).toHaveAttribute("data-status", "halted");
  await expect(page.locator("#run")).toBeDisabled();
  await expect(page.locator("#single-step")).toBeDisabled();
  await expect(page.locator("#ones")).toHaveText("6");
  await expect(page.locator("#comparison-list")).toContainText("21");
  await page.click("#reset");
  await expect(page.locator("#steps")).toHaveText("0");
  await comparePython(page, request, "busy_beaver_3");
  await steps(page, 3);
  await choose(page, 2);
  await comparePython(page, request, "busy_beaver_2");
});

test("slow playback, step while running, pause, continue, and no advancement after halt", async ({ page, request }) => {
  await open(page);
  await choose(page, 2);
  await page.click("#run");
  await expect.poll(() => count(page)).toBe(1);
  await page.click("#single-step");
  await expect(page.locator("#steps")).toHaveText("2");
  await expect(status(page)).toHaveAttribute("data-status", "paused");
  await page.waitForTimeout(1100);
  expect(await count(page)).toBe(2);
  await page.click("#run");
  await expect.poll(() => count(page)).toBe(3);
  await page.click("#pause");
  await expect(status(page)).toHaveAttribute("data-status", "paused");
  await page.click("#single-step");
  await expect(page.locator("#steps")).toHaveText("4");
  await comparePython(page, request, "busy_beaver_2");
  await page.click("#run");
  await expect(status(page)).toHaveAttribute("data-status", "halted");
  expect(await count(page)).toBe(6);
  await expect(page.locator("#ones")).toHaveText("4");
  await page.waitForTimeout(1100);
  expect(await count(page)).toBe(6);
});

test("fixed slow speed and live speed changes still work past 200 steps", async ({ page, request }) => {
  await open(page);
  await choose(page, 5);
  await steps(page, 201);
  await comparePython(page, request, "busy_beaver_5");
  await page.selectOption("#speed-mode", "fixed");
  await page.locator("#speed").fill("2000");
  await page.click("#run");
  await page.waitForTimeout(200);
  expect(await count(page)).toBe(201);
  await page.locator("#speed").fill("50");
  await expect(status(page)).toHaveAttribute("data-status", "running");
  await expect.poll(() => count(page)).toBeGreaterThan(202);
  await page.click("#pause");
  await expect(status(page)).toHaveAttribute("data-status", "paused");
  const paused = await count(page);
  await page.waitForTimeout(150);
  expect(await count(page)).toBe(paused);
  await comparePython(page, request, "busy_beaver_5");
});

test("changing mode and limits pauses in place; lowering, raising and invalid limits", async ({ page, request }) => {
  await open(page);
  await choose(page, 5);
  await expect(page.locator("#execution-mode")).toHaveValue("until-halt");
  await expect(page.locator("#max-steps")).toBeDisabled();
  await steps(page, 250);
  await page.selectOption("#execution-mode", "limited");
  await expect(status(page)).toHaveAttribute("data-status", "paused");
  await page.locator("#max-steps").fill("240");
  await expect(status(page)).toHaveAttribute("data-status", "limit");
  expect(await count(page)).toBe(250);
  await expect(page.locator("#single-step")).toBeDisabled();
  await page.locator("#max-steps").fill("255");
  await page.click("#run");
  await expect(page.locator("#steps")).toHaveText("255");
  await expect(page.locator("#halt-message")).toContainText("未停机");
  await comparePython(page, request, "busy_beaver_5");
  for (const invalid of ["", "-1", "1000001", "2.5"]) {
    await page.locator("#max-steps").fill(invalid);
    await expect(page.locator("#settings-error")).not.toBeEmpty();
    await expect(page.locator("#run")).toBeDisabled();
  }
  await page.locator("#max-steps").fill("1000");
  await page.click("#run");
  await expect(page.locator("#steps")).toHaveText("1,000");
  await comparePython(page, request, "busy_beaver_5");
  await page.selectOption("#execution-mode", "until-halt");
  await expect(status(page)).toHaveAttribute("data-status", "paused");
  expect(await count(page)).toBe(1000);
  await expect(page.locator("#run")).toBeEnabled();
  await page.click("#reset");
  await expect(page.locator("#steps")).toHaveText("0");
  await page.selectOption("#execution-mode", "limited");
  await page.locator("#max-steps").fill("0");
  await expect(status(page)).toHaveAttribute("data-status", "limit");
  expect(await count(page)).toBe(0);
});

test("rapid commands and stale snapshots cannot overwrite a newer command or run", async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        window.testWorker = this;
        this.addEventListener("message", (event) => { window.lastWorkerFrame = event.data; });
      }
    };
  });
  await open(page);
  await steps(page, 3);
  const oldFrame = await page.evaluate(() => window.lastWorkerFrame);
  await page.evaluate(() => {
    document.querySelector("#run").click();
    document.querySelector("#single-step").click();
    document.querySelector("#pause").click();
  });
  await expect(page.locator("#steps")).toHaveText("4");
  await expect(status(page)).toHaveAttribute("data-status", "paused");
  await page.evaluate((frame) => {
    window.testWorker.onmessage({ data: { ...frame, sequence: 999999, steps_executed: 999 } });
    window.testWorker.onmessage({ data: { ...window.lastWorkerFrame, sequence: 0, steps_executed: 999 } });
  }, oldFrame);
  expect(await count(page)).toBe(4);
  await page.click("#reset");
  await expect(page.locator("#steps")).toHaveText("0");
  await page.evaluate((frame) => window.testWorker.onmessage({ data: { ...frame, commandId: 999999, sequence: 999999 } }), oldFrame);
  expect(await count(page)).toBe(0);
  await page.click("#run");
  await choose(page, 4);
  await page.waitForTimeout(1100);
  expect(await count(page)).toBe(0);
});

test("four-state auto playback reaches 107 / 13", async ({ page }) => {
  await open(page);
  await choose(page, 4);
  await page.click("#run");
  await expect(status(page)).toHaveAttribute("data-status", "halted", { timeout: 20000 });
  await expect(page.locator("#steps")).toHaveText("107");
  await expect(page.locator("#ones")).toHaveText("13");
});

test("complete five-state browser run with its default opening animation", async ({ page, browser }, testInfo) => {
  await open(page);
  await choose(page, 5);
  const elapsedMs = await page.evaluate(() => new Promise((resolve) => {
    const start = performance.now();
    const observer = new MutationObserver(() => {
      if (document.querySelector("#result-badge").dataset.status === "halted") {
        observer.disconnect();
        resolve(performance.now() - start);
      }
    });
    observer.observe(document.querySelector("#result-badge"), { attributes: true });
    document.querySelector("#run").click();
  }));
  await expect(page.locator("#steps")).toHaveText("47,176,870");
  await expect(page.locator("#ones")).toHaveText("4,098");
  await expect(page.locator("#state")).toHaveText("HALT");
  await expect(page.locator("#trace li")).toHaveCount(200);
  await expect(page.locator("#trace li").first()).toContainText("#47176671:");
  await expect(page.locator("#trace li").last()).toContainText("H");
  const measurement = { browser: browser.version(), elapsedMs, steps: 47176870, ones: 4098, visibility: await page.evaluate(() => document.visibilityState) };
  console.log("BROWSER_FULL_RUN", JSON.stringify(measurement));
  await testInfo.attach("full-run.json", { body: JSON.stringify(measurement, null, 2), contentType: "application/json" });
});

test("high-speed pause response and resume preserve progress", async ({ page, browser }, testInfo) => {
  await open(page);
  await choose(page, 5);
  await steps(page, 250);
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const before = await count(page);
    await page.click("#run");
    await expect.poll(() => count(page)).toBeGreaterThan(before + 1000);
    const elapsedMs = await page.evaluate(() => new Promise((resolve) => {
      const start = performance.now();
      const observer = new MutationObserver(() => {
        if (document.querySelector("#result-badge").dataset.status === "paused") {
          observer.disconnect();
          resolve(performance.now() - start);
        }
      });
      observer.observe(document.querySelector("#result-badge"), { attributes: true });
      document.querySelector("#pause").click();
    }));
    samples.push(elapsedMs);
    const paused = await count(page);
    await page.waitForTimeout(150);
    expect(await count(page)).toBe(paused);
    await page.click("#single-step");
    await expect.poll(() => count(page)).toBe(paused + 1);
  }
  const measurement = { browser: browser.version(), pauseMs: samples, maxMs: Math.max(...samples) };
  console.log("BROWSER_PAUSE", JSON.stringify(measurement));
  await testInfo.attach("pause.json", { body: JSON.stringify(measurement, null, 2), contentType: "application/json" });
  expect(Math.max(...samples)).toBeLessThanOrEqual(200);
});
