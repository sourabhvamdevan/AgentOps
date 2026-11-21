import { defineConfig } from "@playwright/test";

// Run the backend (port 8000) and frontend (port 5173) first; see README.
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173",
    channel: process.env.PW_CHANNEL || undefined, // e.g. PW_CHANNEL=chrome to use an installed Chrome
    trace: "retain-on-failure",
  },
});
