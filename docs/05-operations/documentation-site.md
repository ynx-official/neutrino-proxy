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

2026-10-29 用户确认采用 **GitHub Pages + 自定义域名 + 手动正式发布**，正式域名为 `neutrino-proxy-docs.mrsunshine.cn`。工作流默认 `base_path=/`、`custom_domain=neutrino-proxy-docs.mrsunshine.cn`、`publish=false`；正式发布拒绝空域名或子路径配置。子路径仅用于构建演练，演练时将 `custom_domain` 清空。

### 首次启用

1. 将文档源码与部署配置提交、推送到远端，并确保 `.github/workflows/docs-deploy.yml` 存在于默认分支。当前默认分支为 `master`，开发分支为 `dev`；GitHub 要求手动工作流先存在于默认分支才能触发。若暂不合并开发分支，可仅将部署工作流同步至 `master` 注册入口，运行时必须选择含完整文档源码的 `dev`。不要为启用文档发布而自动合并其他开发改动。
2. 在仓库 Settings → Pages 选择 **GitHub Actions**，并配置 `github-pages` 环境允许发布的分支。需要人工审批时配置环境保护规则。
3. 在 Pages 的 **Custom domain** 填入 `neutrino-proxy-docs.mrsunshine.cn`。使用 Actions 发布时，GitHub 不依赖产物中的 `CNAME` 文件绑定域名，必须配置此项；模块内与构建产物内的 `CNAME` 仅保留为部署声明。
4. 在 DNS 服务商管理的 `mrsunshine.cn` 区域添加以下记录。先绑定 Pages 域名，再添加 DNS；同名主机已有 A/AAAA/CNAME 记录时，先核实用途再替换，避免影响原有服务。

   | 类型 | 主机记录 | 记录值 | TTL |
   | --- | --- | --- | --- |
   | CNAME | `neutrino-proxy-docs` | `ynx-official.github.io` | 服务商默认 |

   记录值不包含协议、路径或仓库名。建议在 GitHub 账户 Pages 设置完成域名所有权验证；验证需要的 TXT 值以 GitHub 页面实际给出的值为准。
5. 运行一次 `publish=false` 的演练，确认单元测试、生产构建、链接检查和浏览器验收全部通过，再在当次正式发布授权下选择 `publish=true`。部署 job 仅在验证通过后取得 Pages 写权限。
6. 等待 DNS 校验与证书签发完成，在 Pages 启用 **Enforce HTTPS**。首次上线验收 HTTPS 首页、直接访问 `/pages/793dcb/`、带标题锚点的旧路径、静态资源、搜索与真实 404，然后更新根 README 的官网入口。

DNS 与证书生效可能需要等待。PowerShell 可用 `Resolve-DnsName neutrino-proxy-docs.mrsunshine.cn -Type CNAME` 检查；若本机使用代理 DNS，应同时通过公共解析器验证，不能把代理返回的保留地址当成真实站点地址。

### 手动发布与回滚

在 Actions 中选择 `Deploy documentation`，选择已经验证且包含文档源码的分支；默认只验证并上传构建产物，正式发布时勾选 `publish`。GitHub CLI 的 `<approved-ref>` 使用已批准的分支或标签，运行后核对该次工作流的提交 SHA：

```sh
gh workflow run docs-deploy.yml --ref <approved-ref> -f publish=false -f base_path=/ -f custom_domain=neutrino-proxy-docs.mrsunshine.cn
# 仅在当次正式发布已获授权后执行：
gh workflow run docs-deploy.yml --ref <approved-ref> -f publish=true -f base_path=/ -f custom_domain=neutrino-proxy-docs.mrsunshine.cn
```

回滚时选择已验证且包含该工作流的历史 ref，使用相同域名与根路径重新手动发布。环境变量只包含公开部署参数，不在仓库保存凭据。

### 旧域名与上线状态

页面 permalink 与标题锚点保持不变。旧域名 `neutrino-proxy-docs.asgc.fun` 和 `neutrino-proxy.dromara.org` 的控制权未确认；新站无法替代旧域名管理员配置 HTTP 301/308 跳转。需要由旧站保留完整路径与查询参数重定向到新域名，并验证浏览器保留标题片段。正式上线前根 README 继续保留已有官网入口。

2026-10-29 实际状态：

- 仓库公开，默认分支为 `master`；远端工作流列表中尚无 `Deploy documentation`。本地 `dev` 的 VitePress 迁移提交与本轮部署配置尚待推送。
- 已通过 GitHub API 启用 Pages，确认 `build_type=workflow` 并绑定 `neutrino-proxy-docs.mrsunshine.cn`。未运行发布，Pages 状态仍为空。
- 公共 DNS 查询尚无目标 CNAME，当前有 A 记录；需域名管理员核实并配置上述 CNAME。未修改 DNS，证书尚未签发，`https_enforced=false`。
- 以新域名、根路径执行 `npm run check`：11 项测试、37 页、2,190 条链接/资源检查通过；`npm run test:e2e`：42 项 Chromium 测试通过。工作流 YAML、默认发布参数与产物 `CNAME` / `site-manifest.json` 均已检查。
- 本轮未提交、推送或执行正式发布。Pages 设置已准备，DNS、代码同步和首次发布仍待完成。

文档 CI 在相关文件的 push/PR 上分别验证根路径和子路径，不会发布。Java `v*` Release 不触发文档部署。

依据：[GitHub 自定义域名配置](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)、[手动触发工作流](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)。
