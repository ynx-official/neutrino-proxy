# VuePress 到 VitePress 迁移

状态：Review  
最后更新：2026-10-29  
关联文档：[运维说明](../05-operations/documentation-site.md)、[文档索引](../README.md)、[项目约定](../../AGENTS.md)

## 已确认范围

用户要求迁移到 VitePress 最新稳定版，保留现有文档与旧链接，完善构建、部署和验证；用户选择 `awesome-design-md` 的 `mintlify` 风格。2026-10-29 查询 npm `latest` 为 1.6.4，2.x 仍为 alpha，因此固定使用 1.6.4。

本次仅修改文档站及其 CI/部署配置。源码目录名保持兼容，Markdown 内容通过构建适配，原文和 public 资源有 SHA-256 回归基线。没有授权提交、推送或正式上线。

## 实现选择

- 使用 VitePress 官方默认主题扩展 Mintlify 文档样式，沿用项目 Logo。以白色画布、细边框、三栏阅读布局、少量薄荷绿强调为主。
- 以 `permalink` 为路由权威来源，生成实际目录索引。中文文件路径不再决定公开链接。
- 沿用 VuePress 1.x 标题 slug，避免已有带锚点链接失效。
- 保留历史 Vdoing 配置文档并加说明，不将其误写为当前站点配置。
- 字体优先 Inter / Geist Mono，使用系统中文及等宽回退，不引入外部字体请求。深色主题为补充设计；浅色链接使用更深的绿色确保可读性。
- 正式域名未确认：遗留 CNAME 与 README 域名不同。部署输入显式指定域名；默认不写入旧域名。
- 配置与测试均用 JavaScript，不更改项目其他技术栈。
- 移除失效的 VuePress 配置、Stylus 和旧插件。旧插件的自动统计/广告注入未迁入新站；原文中的赞助、友情链接、图片均保留。正式部署前如需访问统计，应明确采用的服务与配置。
- 原文的两条断链 `/pages/088c16/`、`/pages/33d574/` 在构建时指向对应 Vdoing 官方教程；原文不改写，断链检查不豁免。

## 验收标准

1. 37 篇原文及 145 个原资源保持一致，36 个原 permalink 和首页均生成可直接访问的 HTML。
2. 有斜杠、无斜杠的旧入口以及既有标题锚点可访问；重复/非法 permalink 阻断构建。
3. 首页、文档、归档、404、中文搜索、空搜索结果、代码复制、图片放大、移动导航和明暗模式可用。
4. 根路径和 `/neutrino-proxy/` 子路径构建均检查本地链接、资源和锚点。
5. npm 锁文件纳入版本管理，CI 使用 `npm ci`。手动部署默认不发布，不依赖本机 Bash 私有脚本。

## 验证记录

本地环境：Windows、Node.js 22.12.0、npm 10.9.0、VitePress 1.6.4、Vue 3.5.44。执行日期：2026-10-29。

| 验证 | 实际结果 |
| --- | --- |
| `npm ci --no-fund` | 锁文件全新安装成功 |
| `npm test` | 8 项通过，含内容/资源、路由冲突、旧锚点、排序与部署参数 |
| 根路径生产构建及 `check:links` | 37 页、全部原 Markdown 标题锚点、2,190 条本地链接/资源引用通过 |
| `/neutrino-proxy/` 子路径构建及 `check:links` | 同样 37 页、2,190 条引用通过 |
| Playwright 根路径 | 42 项通过，Chromium；另以本机 Edge 完成过根路径验收 |
| Playwright 子路径 | 42 项通过，Chromium |
| `npm run test:nginx` | Docker 中 73 种 URL 形式通过；页面/资源真实 404；跳转保留外部端口 |
| Nginx 配置 | `nginx -t` 通过 |
| 工作流 YAML、`git diff --check` | 通过本地语法解析与差异空白检查 |

浏览器检查覆盖全部页面直达及客户端加载、有/无尾斜杠、中文搜索及空结果、结果跳转、代码复制、图片放大与关闭、深色主题、390px 移动导航、首页 Logo 布局及 404。已查看首页、移动端与深色文档截图；预览服务器和测试容器在检查后自动关闭。

GitHub Actions 未在远端触发，未发布、未修改 DNS。当前 CNAME 与 README 域名不一致，正式发布时需明确实际域名。

## 依赖审计限制

`npm audit` 实际剩余 3 项开发依赖告警（1 high、2 moderate），来自 VitePress 1.6.4 → Vite 5.4.21 → esbuild 的上游依赖链，npm 标记无可用兼容修复。已更新本项目直接使用的 markdown-it，并覆盖旧交互工具的 tmp 为已修复版本；未强行覆盖 VitePress 的 Vite 主版本，也未改用 2.x alpha。

这些构建/开发服务依赖不部署到静态服务器；开发/预览命令仅绑定本机。`npm audit --omit=dev` 返回 0，但本模块依赖均为 devDependencies，因此不能据此声称依赖整体无漏洞。后续稳定版提供兼容修复时应升级并重跑根/子路径验收。

## 参考

- [VitePress 1.x 路由](https://vuejs.github.io/vitepress/v1/guide/routing)
- [VitePress 1.x 部署](https://vuejs.github.io/vitepress/v1/guide/deploy)
- [VuePress 1.9.2 标题规则](https://unpkg.com/@vuepress/shared-utils@1.9.2/lib/slugify.js)
