# 文档站构建与部署

状态：Review  
最后更新：2026-10-29  
关联文档：[文档索引](../README.md)、[迁移与验收](../06-delivery/vitepress-migration.md)、[项目约定](../../AGENTS.md)

## 运行环境与源码

`neutrino-proxy-vuepress/` 保留原目录名，实际构建器为 VitePress 1.6.4（迁移当日 npm `latest`）。使用 JavaScript 配置、Node.js 22.12+ 和 npm，提交 `package-lock.json`。文档站与 Java、管理后台、桌面客户端独立构建。

```sh
cd neutrino-proxy-vuepress
npm ci
npm run dev
```

开发服务器仅监听本机，完成后按 Ctrl+C 停止，不作为生产服务。

```sh
npm run check
npx playwright install chromium
npm run test:e2e
npm run preview
```

`check` 执行单元测试、生产构建、产物链接与锚点检查。Playwright 自动启动并关闭独立预览服务器。Linux 首次安装浏览器时使用 `npx playwright install --with-deps chromium`。

## 内容维护

- 原有 37 篇 Markdown 保留在 `docs/`；145 个静态资源由 `.vuepress/public/` 移到 `docs/public/`，字节保持不变。
- 非首页文档必须声明唯一 `permalink`。构建器将其映射为目录首页，例如 `/pages/793dcb/` 对应 `pages/793dcb/index.html`，不依赖单页应用回退。
- 保留 VuePress 标题 slug 规则，包括数字开头的 `_` 与中文标点。不要随意更改标题、permalink 或复制相同地址到另一篇文档。
- 侧栏来自现有目录和 frontmatter；`/blog/` 自动列出文档。Vdoing 配置说明继续保留，并显示历史文档提示。
- 新站提供本地中文搜索、代码复制、图片放大和明暗主题。搜索无需第三方服务。
- `tests/fixtures/legacy-site.json` 是迁移时的原文与资源基线。后续有意修订原文时，应审查内容差异并同步对应哈希；不能通过更新基线绕过非预期删除或丢失。
- 基线同时保留原始哈希和文本规范化哈希：Markdown、SVG、HTML 仅统一 CRLF/LF 后比较，二进制资源逐字节比较，使 Windows 与 Linux CI 一致。
- `utils/editFrontmatter.js` 是保留的手动工具，依赖已显式声明；不在构建或 CI 中运行。

## 根路径与子路径

默认 `DOCS_BASE=/`，产物在 `docs/.vitepress/dist/`。自建静态服务器上传整个目录，包括 `.nojekyll`。可参考 [Nginx 配置](../../neutrino-proxy-vuepress/hosting/nginx.conf)，将产物放到 `/usr/share/nginx/html/`，使用目录索引并保留真实 404 状态。

GitHub 仓库 Pages 通常采用 `/neutrino-proxy/`。PowerShell 示例：

```powershell
$env:DOCS_BASE = '/neutrino-proxy/'
npm run check
npm run test:e2e
Remove-Item Env:DOCS_BASE
```

POSIX shell 示例：

```sh
DOCS_BASE=/neutrino-proxy/ npm run check
DOCS_BASE=/neutrino-proxy/ npm run test:e2e
```

构建和验证必须使用相同的 base。自建服务器采用子路径时，将产物放入该路径对应的目录，并同步调整 Nginx 的资源缓存与 404 路径。

安装 Docker 后，可对根路径构建执行 `npm run test:nginx`。它启动一次性 Nginx 容器，在本机随机端口检查 73 种旧 URL、重定向端口、页面与资源的真实 404，并在结束时停止删除容器。容器首次使用会拉取 `nginx:stable-alpine`。

离线或已有浏览器的 Windows 环境，可设置 `PLAYWRIGHT_CHANNEL=msedge` 使用本机 Edge；默认测试使用 Playwright Chromium。

## 手动部署到 GitHub Pages

1. 在仓库 Settings → Pages 选择 GitHub Actions，并配置 `github-pages` 环境允许的部署分支；如需审批，配置环境保护规则。
2. 运行 `Deploy documentation`，选择要构建的 ref。`publish=false` 默认只构建与验证并上传 Pages 产物。
3. 正式发布时当次选择 `publish=true`。只有单元测试、构建、内部链接与浏览器验收通过后，部署 job 才有 Pages 写权限。
4. 默认 `base_path=/neutrino-proxy/`。自定义域名须填 `base_path=/` 和 `custom_domain`，并事先配置 Pages 域名及 DNS。脚本校验域名格式并生成 `CNAME`。

根目录遗留 `CNAME` 中的域名与 README 官网地址不一致，因此构建不会自动采用它，也不会改 DNS。当前正式域名需在发布时明确指定。环境变量只接受公开部署路径与域名，不需要在仓库写入凭据。

文档 CI 在相关文件的 push/PR 上分别验证根路径和子路径，不会发布。Java `v*` Release 不触发文档部署。回滚时手动选择已验证的历史 ref 重新运行发布工作流。
