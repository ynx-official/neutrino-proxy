import { test, expect } from "@playwright/test";

test("tray uses the approved compact layout and updates its exclusive action live", async ({ page }) => {
  await page.setViewportSize({ width: 288, height: 342 });
  await page.addInitScript(() => {
    let listener = () => {};
    let snapshot = { revision: 1, label: "已连接", tone: "connected", endpoint: "edge.example.com:9002", action: "disconnect", actionLabel: "断开连接", disabled: false };
    window.__trayCalls = [];
    window.__updateTray = (patch) => { snapshot = { ...snapshot, ...patch, revision: snapshot.revision + 1 }; listener(snapshot); };
    window.__NEUTRINO_TEST_BRIDGE__ = {
      subscribe: (callback) => { listener = callback; return () => {}; },
      invoke: async (command, args) => { window.__trayCalls.push({ command, args }); if (command === "tray_snapshot") return snapshot; },
    };
  });
  await page.goto("/tray.html");
  await expect(page.getByRole("status")).toHaveText("已连接");
  await expect(page.getByRole("button")).toHaveCount(4);
  await expect(page.getByRole("button", { name: "断开连接", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "连接", exact: true })).toHaveCount(0);
  expect(await page.locator(".tray-panel").evaluate((element) => element.scrollHeight <= element.clientHeight)).toBe(true);
  await page.screenshot({ path: "test-results/tray-connected.png" });
  await page.evaluate(() => window.__updateTray({ label: "未连接", tone: "idle", action: "connect", actionLabel: "连接" }));
  await expect(page.getByRole("button", { name: "连接", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "断开连接", exact: true })).toHaveCount(0);
  await page.screenshot({ path: "test-results/tray-idle.png" });
  await page.getByRole("button", { name: "查看日志" }).click();
  await expect.poll(() => page.evaluate(() => window.__trayCalls.at(-1))).toEqual({ command: "tray_action", args: { action: "logs" } });
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => window.__trayCalls.at(-1).command)).toBe("close_tray");
});
