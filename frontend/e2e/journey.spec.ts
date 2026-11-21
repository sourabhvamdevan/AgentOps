import { expect, test } from "@playwright/test";

test("submit sample request → live events → refresh → approve → final report", async ({ page }) => {
  await page.goto("/monitor");
  await expect(page.getByTestId("mode-badge").first()).toContainText("Demo mode (deterministic rules)");

  await page.getByTestId("run-button").click();
  await expect(page).toHaveURL(/\/monitor\/[0-9a-f-]{36}$/);

  const panel = page.getByTestId("approval-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("₹6,85,000");
  await expect(page.getByTestId("status-badge").first()).toHaveText("Waiting for approval");
  const events = page.getByTestId("timeline-event");
  await expect(events.last()).toHaveAttribute("data-event-type", "approval_requested");
  const countBefore = await events.count();

  // Refresh mid-execution: state and timeline are restored from the backend.
  await page.reload();
  await expect(panel).toBeVisible();
  await expect(events).toHaveCount(countBefore);
  await expect(page.getByTestId("pipeline-human_review")).toHaveAttribute("data-status", "waiting");

  await page.getByLabel("Decision comment").fill("Looks good");
  await panel.getByRole("button", { name: "Approve" }).click();

  const report = page.getByTestId("report-view");
  await expect(report).toBeVisible();
  await expect(report).toContainText("Outcome: Approved");
  await expect(report).toContainText("Zenvolt Technologies");
  await expect(report).toContainText("All data is fictional. No real purchase was made.");
  await expect(events.last()).toHaveAttribute("data-event-type", "workflow_completed");
  await expect(page.getByTestId("pipeline-approval_agent")).toHaveAttribute("data-status", "completed");
});

test("auto-approved and failed-validation samples", async ({ page }) => {
  await page.goto("/monitor");
  await page.getByRole("button", { name: "Finance monitors" }).click();
  await expect(page.getByTestId("report-view")).toContainText("Outcome: Approved");
  await expect(page.getByTestId("pipeline-human_review")).toHaveAttribute("data-status", "skipped");

  await page.getByRole("button", { name: "Vague request" }).click();
  await expect(page.getByTestId("report-view")).toContainText("Outcome: Failed validation");
  await expect(page.getByTestId("pipeline-vendor_agent")).toHaveAttribute("data-status", "skipped");
});
