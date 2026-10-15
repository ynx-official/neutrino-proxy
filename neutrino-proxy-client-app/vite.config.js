import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  clearScreen: false,
  server: { host: "127.0.0.1", port: 1420, strictPort: true },
  build: { target: ["es2021", "chrome105", "safari14"] },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.js"],
    restoreMocks: true,
  },
});
