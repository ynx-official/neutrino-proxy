import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import TrayView from "./TrayView.vue";
import { call, subscribe } from "./services/desktop";

vi.mock("./services/desktop", () => ({ call: vi.fn(), subscribe: vi.fn() }));
let notify;
const connected = { revision: 2, label: "已连接", tone: "connected", endpoint: "edge.example.com:9002", action: "disconnect", actionLabel: "断开连接", disabled: false };
beforeEach(() => {
  vi.clearAllMocks();
  subscribe.mockImplementation(async (callback) => { notify = callback; return vi.fn(); });
  call.mockImplementation(async (command) => command === "tray_snapshot" ? connected : undefined);
});

describe("tray popup", () => {
  it("shows a single live connection action and dispatches its exact intent", async () => {
    const wrapper = mount(TrayView);
    await flushPromises();
    expect(wrapper.text()).toContain("edge.example.com:9002");
    expect(wrapper.findAll('[data-connection-action]')).toHaveLength(1);
    expect(wrapper.get('[data-connection-action]').text()).toBe("断开连接");
    await wrapper.get('[data-connection-action]').trigger("click");
    await flushPromises();
    expect(call).toHaveBeenCalledWith("tray_action", { action: "disconnect" });
    notify({ ...connected, revision: 3, label: "未连接", tone: "idle", action: "connect", actionLabel: "连接" });
    await flushPromises();
    expect(wrapper.get('[data-connection-action]').text()).toBe("连接");
    expect(wrapper.text()).not.toContain("断开连接");
    wrapper.unmount();
  });
  it("keeps newer events when the initial snapshot arrives late, and disables stopping", async () => {
    let resolve;
    call.mockImplementation(async (command) => command === "tray_snapshot" ? new Promise((done) => { resolve = done; }) : undefined);
    const wrapper = mount(TrayView);
    await flushPromises();
    notify({ ...connected, revision: 5, label: "正在断开", action: "none", actionLabel: "正在断开", disabled: true });
    resolve(connected);
    await flushPromises();
    expect(wrapper.get('[data-connection-action]').text()).toBe("正在断开");
    expect(wrapper.get('[data-connection-action]').attributes("disabled")).toBeDefined();
    wrapper.unmount();
  });
  it("opens logs, closes on Escape, and prevents repeat activation while busy", async () => {
    const wrapper = mount(TrayView);
    await flushPromises();
    let finish;
    call.mockImplementation(() => new Promise((done) => { finish = done; }));
    await wrapper.get('[data-action="logs"]').trigger("click");
    await wrapper.get('[data-action="logs"]').trigger("click");
    expect(call.mock.calls.filter(([name]) => name === "tray_action")).toEqual([["tray_action", { action: "logs" }]]);
    finish();
    await flushPromises();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(call).toHaveBeenCalledWith("close_tray");
    wrapper.unmount();
  });
  it("keeps failed commands visible instead of reporting success", async () => {
    const wrapper = mount(TrayView);
    await flushPromises();
    call.mockRejectedValueOnce(new Error("连接状态已变化，请重试"));
    await wrapper.get('[data-connection-action]').trigger("click");
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe("连接状态已变化，请重试");
    expect(wrapper.get('[data-connection-action]').attributes("disabled")).toBeUndefined();
    wrapper.unmount();
  });
});
