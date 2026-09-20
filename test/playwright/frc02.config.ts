import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
 testDir: ".", testMatch: "frc02.spec.ts", workers: 1, retries: 0, timeout: 120_000,
 reporter: "list", outputDir: "../../output/playwright/frc02",
 use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:3102", trace: "retain-on-failure", screenshot: "only-on-failure" },
});
