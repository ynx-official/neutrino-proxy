# Neutrino Proxy 文档站

目录名保留兼容，实际使用 VitePress 1.6.4 + Vue 3。需要 Node.js 22.12+ 和 npm。

```sh
npm ci
npm run dev
```

验证：`npm run check`；浏览器验收：`npx playwright install chromium` 后运行 `npm run test:e2e`。

产物：`docs/.vitepress/dist/`。使用 `npm run preview` 本地预览。

完整内容维护、子路径构建、自建静态部署与手动 GitHub Pages 发布见 [文档站运维说明](../docs/05-operations/documentation-site.md)。
