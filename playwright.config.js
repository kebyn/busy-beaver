import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 60000,
  expect: { timeout: 5000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5057",
    browserName: "chromium",
    viewport: { width: 1280, height: 1000 },
    locale: "zh-CN",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "uv run flask --app busy_beaver web --port 5057",
    url: "http://127.0.0.1:5057",
    reuseExistingServer: false,
    timeout: 15000,
  },
});
