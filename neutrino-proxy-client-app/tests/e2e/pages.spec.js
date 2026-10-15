import { test, expect } from "@playwright/test";

async function bridge(page, connected = false) {
  await page.addInitScript(
    ({ connected }) => {
      const config = {
        server: connected ? "edge.example.com" : "",
        port: 9002,
        ssl: true,
        clientId: "test-client",
        reconnectSeconds: 10,
        unlimited: false,
        udpPortRange: "10000-10500",
        readIdleSeconds: 120,
        heartbeatSeconds: 20,
        certificatePath: "",
      };
      let snapshot = {
        config,
        state: connected ? "connected" : "idle",
        detail: "填写连接信息，开始第一次连接",
        revision: 1,
        logs: connected
          ? [
              {
                id: 1,
                time: "2026-10-15T02:24:08Z",
                level: "info",
                source: "连接",
                message: "连接已建立",
              },
              {
                id: 2,
                time: "2026-10-15T02:24:09Z",
                level: "info",
                source: "认证",
                message: "License 验证通过",
              },
              {
                id: 3,
                time: "2026-10-15T02:24:09Z",
                level: "info",
                source: "连接",
                message: "开始后台运行",
              },
            ]
          : [],
        hasLicense: connected,
        licenseHint: "•••• •••• •••• 8F2A",
        connectedAt: connected
          ? new Date(Date.now() - 8316000).toISOString()
          : null,
        retryAt: null,
        pendingConfig: false,
        version: "0.1.0",
      };
      let listener = () => {}, navigationListener = () => {}, pendingRoute = null;
      window.__navigateFromTray = (path) => { pendingRoute = path; navigationListener(); };
      window.__NEUTRINO_TEST_BRIDGE__ = {
        subscribeNavigation: (callback) => { navigationListener = callback; return () => {}; },
        subscribe: (callback) => {
          listener = callback;
          return () => {};
        },
        invoke: async (command, args) => {
          if (command === "take_navigation") { const path = pendingRoute; pendingRoute = null; return path; }
          if (command === "get_snapshot") return structuredClone(snapshot);
          if (command === "save_config") {
            snapshot = {
              ...snapshot,
              config: args.request.config,
              hasLicense: true,
              state: args.request.connect ? "connected" : snapshot.state,
              connectedAt: args.request.connect
                ? new Date().toISOString()
                : snapshot.connectedAt,
              revision: snapshot.revision + 1,
            };
            listener(structuredClone(snapshot));
            return structuredClone(snapshot);
          }
          if (command === "disconnect") {
            snapshot = {
              ...snapshot,
              state: "idle",
              connectedAt: null,
              revision: snapshot.revision + 1,
            };
            listener(structuredClone(snapshot));
            return;
          }
          throw new Error(`Unsupported test command: ${command}`);
        },
      };
    },
    { connected },
  );
}

test("first run validates configuration and navigates after saving", async ({
  page,
}) => {
  await bridge(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "尚未连接" })).toBeVisible();
  await page.getByRole("button", { name: "填写连接信息" }).click();
  await page.getByRole("button", { name: "保存并连接" }).click();
  await expect(
    page.getByText("请填写服务器地址", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("服务器地址", { exact: true }).fill("edge.example.com");
  await page.getByLabel("License", { exact: true }).fill("test-license");
  await page.screenshot({
    path: "test-results/connection-setup.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "保存并连接" }).click();
  await expect(
    page.getByRole("heading", { name: "已连接", exact: true }),
  ).toBeVisible();
});

test("tray navigation respects unsaved edits and opens logs when accepted", async ({ page }) => {
  await bridge(page, true);
  await page.goto("/#/settings");
  await page.getByLabel("服务器地址", { exact: true }).fill("unsaved.example.com");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.evaluate(() => window.__navigateFromTray("/logs"));
  await expect(page.getByLabel("服务器地址", { exact: true })).toHaveValue("unsaved.example.com");
  page.once("dialog", (dialog) => dialog.accept());
  await page.evaluate(() => window.__navigateFromTray("/logs"));
  await expect(page.getByRole("heading", { name: "日志", exact: true })).toBeVisible();
});

test("approved navigation stays horizontal and opens all three pages", async ({
  page,
}) => {
  await bridge(page, true);
  await page.setViewportSize({ width: 860, height: 620 });
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "主导航" });
  const positions = await Promise.all(
    ["连接", "日志", "设置"].map((name) =>
      nav.getByRole("link", { name, exact: true }).boundingBox(),
    ),
  );
  expect(
    Math.max(...positions.map((box) => box.y)) -
      Math.min(...positions.map((box) => box.y)),
  ).toBeLessThan(2);
  const status = await page
    .getByRole("heading", { name: "已连接", exact: true })
    .boundingBox();
  expect(status.y).toBeGreaterThan(positions[0].y + positions[0].height);
  await nav.getByRole("link", { name: "日志", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "日志", exact: true }),
  ).toBeVisible();
  await nav.getByRole("link", { name: "设置", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "保存并重连" }),
  ).toBeInViewport();
});

test("connected layout presents the endpoint, duration and connection controls", async ({
  page,
}) => {
  await bridge(page, true);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "已连接", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "断开连接" })).toBeVisible();
  await expect(page.locator(".hero-endpoint")).toHaveText(
    "edge.example.com:9002",
  );
  await expect(page.locator(".hero-duration strong")).toHaveText(
    /\d{2}:\d{2}:\d{2}/,
  );
  await expect(page.getByText("SSL", { exact: true })).toBeVisible();
  await expect(
    page.getByText("License 验证通过", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/connected.png", fullPage: true });
  await page.getByRole("button", { name: "全部日志" }).click();
  await expect(
    page.getByRole("heading", { name: "日志", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/logs.png", fullPage: true });
  await page.getByLabel("搜索日志").fill("不存在");
  await expect(page.getByText("当前筛选没有日志")).toBeVisible();
});

test("minimum size and long content remain usable", async ({ page }) => {
  await bridge(page, true);
  await page.setViewportSize({ width: 860, height: 620 });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "断开连接" })).toBeInViewport();
  expect(
    await page
      .locator(".main-content")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/connected-minimum.png",
    fullPage: true,
  });
  await page.goto("/#/settings");
  await expect(page.getByRole("button", { name: "保存并重连" })).toBeVisible();
  const primaryAction = await page
    .getByRole("button", { name: "保存并重连" })
    .boundingBox();
  expect(primaryAction.y + primaryAction.height).toBeLessThanOrEqual(620);
  expect(
    await page.getByRole("button", { name: "高级设置" }).evaluate((element) => {
      const box = element.getBoundingClientRect();
      const hit = document.elementFromPoint(
        box.x + box.width / 2,
        box.y + box.height / 2,
      );
      return element === hit || element.contains(hit);
    }),
  ).toBe(true);
  await page
    .getByLabel("服务器地址", { exact: true })
    .fill("very-long-server-address-for-overflow-check.example.com");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/minimum-size.png",
    fullPage: true,
  });
});

test("default configuration fits the window without unnecessary scrolling", async ({
  page,
}) => {
  await bridge(page);
  await page.goto("/#/settings");
  await expect(page.getByRole("heading", { name: "配置连接" })).toBeVisible();
  const size = await page.locator(".main-content").evaluate((element) => ({
    scroll: element.scrollHeight,
    visible: element.clientHeight,
  }));
  expect(size.scroll).toBeLessThanOrEqual(size.visible);
});

test("SSL and advanced controls stay reachable in a small window", async ({
  page,
}) => {
  await bridge(page, true);
  await page.goto("/#/settings");
  await expect(page.getByLabel("License", { exact: true })).toHaveAttribute(
    "placeholder",
    "已保存 · 留空不修改",
  );
  await page.screenshot({
    path: "test-results/settings-saved.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 860, height: 620 });
  await page.getByRole("switch", { name: "启用 SSL" }).click();
  await expect(page.getByText("信任证书", { exact: true })).toBeHidden();
  await page.screenshot({ path: "test-results/settings.png", fullPage: true });
  await page.getByRole("button", { name: "高级设置" }).click();
  await expect(page.getByLabel("客户端 ID", { exact: true })).toBeVisible();
  await page.getByLabel("UDP 端口范围", { exact: true }).fill("invalid");
  await page.getByRole("button", { name: "保存并重连" }).click();
  await expect(
    page.getByText("请输入有效范围，例如 10000-10500"),
  ).toBeVisible();
});
