import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import ConnectionView from "./ConnectionView.vue";

describe("connection status", () => {
  it("does not pretend to be connected on first launch", () => {
    const wrapper = mount(ConnectionView, {
      props: {
        model: {
          state: "idle",
          config: { server: "" },
          logs: [],
          hasLicense: false,
        },
        actions: {},
      },
    });
    expect(wrapper.text()).toContain("尚未连接");
    expect(wrapper.text()).toContain("填写连接信息");
    expect(wrapper.text()).not.toContain("服务器认证通过");
  });
  it("provides a real disconnect action when authenticated", async () => {
    const disconnect = vi.fn();
    const wrapper = mount(ConnectionView, {
      props: {
        model: {
          state: "connected",
          config: { server: "edge.example.com", port: 9002, ssl: true },
          logs: [],
          licenseHint: "•••• 8F2A",
          connectedAt: new Date().toISOString(),
        },
        actions: { disconnect },
      },
    });
    await wrapper.get('[data-testid="disconnect"]').trigger("click");
    expect(disconnect).toHaveBeenCalledOnce();
    expect(wrapper.text()).toContain("已连接");
    expect(wrapper.text()).toContain("edge.example.com");
  });
});
