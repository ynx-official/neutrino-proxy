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
- 顶部导航按文档、案例、支持、更新记录切换栏目；“文档”下拉只列“安装部署、使用须知、常见问题”三个分类，分别进入该类首篇文章。左侧仅显示当前栏目的文章，右侧显示本页标题目录。侧栏各组默认全部展开，支持手动收起；文章相对分类标题缩进，并用细竖线标识层级。
- `scripts/navigation.mjs` 根据原文目录归类，并将每个旧 permalink 关联到对应侧栏；`06.关于我们/` 归入支持栏目。新增文章沿用所在目录分类，新增顶级目录时须显式配置栏目，避免漏掉导航入口。
- Vdoing 配置说明通过首页页脚“历史站点资料”访问，使用独立侧栏并保留历史文档提示，不混入产品常见问题。`/blog/` 保留全文档索引。
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
5. 等待 DNS 校验与证书签发完成，在 Pages 启用 **Enforce HTTPS**。运行一次 `publish=false` 的演练，确认单元测试、生产构建、链接检查和浏览器验收全部通过，再在当次正式发布授权下选择 `publish=true`。部署 job 仅在验证通过后取得 Pages 写权限。
6. 部署后 `verify-live` 从 GitHub runner 检查实际 HTTPS 域名：线上清单、真实 404、HTTP 永久跳转与路径/查询参数保留，以及完整浏览器用例。该阶段失败表示发布后的验收未通过，站点不会自动回滚；应检查日志并修复或按授权回滚。首次上线验收完成后更新根 README 的官网入口。

DNS 与证书生效可能需要等待。PowerShell 可用 `Resolve-DnsName neutrino-proxy-docs.mrsunshine.cn -Type CNAME` 检查；若本机使用代理 DNS，应同时通过公共解析器验证，不能把代理返回的保留地址当成真实站点地址。

### 手动发布与回滚

在 Actions 中选择 `Deploy documentation`，选择已经验证且包含文档源码的分支；默认只验证并上传构建产物，正式发布时勾选 `publish`。GitHub CLI 的 `<approved-ref>` 使用已批准的分支或标签，运行后核对该次工作流的提交 SHA：

```sh
gh workflow run docs-deploy.yml --repo ynx-official/neutrino-proxy --ref <approved-ref> -f publish=false -f base_path=/ -f custom_domain=neutrino-proxy-docs.mrsunshine.cn
# 仅在当次正式发布已获授权后执行：
gh workflow run docs-deploy.yml --repo ynx-official/neutrino-proxy --ref <approved-ref> -f publish=true -f base_path=/ -f custom_domain=neutrino-proxy-docs.mrsunshine.cn
```

始终显式指定 `--repo ynx-official/neutrino-proxy`，避免 fork 仓库被 GitHub CLI 自动解析为上游仓库。回滚时选择已验证且包含该工作流的历史 ref，使用相同域名与根路径重新手动发布。环境变量只包含公开部署参数，不在仓库保存凭据。

在与发布版本一致的源码目录中，也可设置 `DOCS_TEST_URL=https://neutrino-proxy-docs.mrsunshine.cn/`，运行 `node scripts/check-live-deployment.mjs` 和 `npm run test:e2e` 复核线上站点。设置该变量后 Playwright 不启动本地预览服务；未设置时仍验证本地构建。公网验证受执行环境网络影响，连接失败不能记为测试通过。

### 旧域名与上线状态

页面 permalink 与标题锚点保持不变。旧域名 `neutrino-proxy-docs.asgc.fun` 和 `neutrino-proxy.dromara.org` 的控制权未确认；新站无法替代旧域名管理员配置 HTTP 301/308 跳转。需要由旧站保留完整路径与查询参数重定向到新域名，并验证浏览器保留标题片段。根 README 的官网与快速上手入口已更新为本次确认的新域名。

2026-10-29 实际状态：

- 用户已授权提交并推送 `dev`、仅同步部署工作流到 `master`，并在 DNS 就绪后执行首次发布和验证。
- `dev` 已推送迁移提交 `3d486fce`、域名部署配置 `37ef4e67` 与线上验收配置 `7672a3a7`；`master` 的 `d0e6003d`、`b3750c39` 仅新增及更新 `.github/workflows/docs-deploy.yml`。已验证工作流内容与发布版本一致，未合并其他开发改动。
- Pages 使用 `build_type=workflow`，绑定 `neutrino-proxy-docs.mrsunshine.cn`；`github-pages` 环境保留 `master` 并新增精确的 `dev` 分支许可。
- 公共 DNS 经 Google 与 Cloudflare 解析确认 CNAME 为 `ynx-official.github.io`。DNS 由用户配置；证书状态已为 `approved`，`https_enforced=true`。实际 HTTPS 首页返回 200，浏览器验证 TLS 1.3 与域名匹配；HTTP 文档 URL 返回 301，跳转到相同 HTTPS 路径。
- [首次发布运行](https://github.com/ynx-official/neutrino-proxy/actions/runs/40835529251) 构建与部署均成功，发布提交为 `37ef4e67901fabbe0cee83135f572b0aa5e3d46a`。
- [完整发布与线上验收](https://github.com/ynx-official/neutrino-proxy/actions/runs/40837776895) 的 `build`、`deploy`、`verify-live` 全部成功。当前发布提交为 `7672a3a7794dba7da78c5c34c78b183f8d4a303b`，实际 HTTPS 站点的 42 项 Chromium 用例全部通过，覆盖 37 页、无尾斜杠入口、标题书签、搜索、代码复制、图片放大、主题及移动端。额外检查线上清单、两类真实 404、HTTP 301/308 到 HTTPS 的同路径/同查询参数跳转通过。
- [文档 CI](https://github.com/ynx-official/neutrino-proxy/actions/runs/40837749117) 根路径与子路径任务全部通过，包括根路径 Nginx 验证。
- 以新域名、根路径执行 `npm run check`：11 项测试、37 页、2,190 条链接/资源检查通过；`npm run test:e2e`：42 项 Chromium 测试通过。工作流 YAML、默认发布参数与产物 `CNAME` / `site-manifest.json` 均已检查。
- 本机公网完整测试遇到连接关闭、TLS 重置和导航超时，未记为通过；本机已确认 HTTPS 首页、线上清单与两类真实 404。上述完整线上验收以 GitHub runner 的实际成功结果为依据，没有跳过用例、放宽断言或禁用证书验证。
- 工作区同时存在其他导航相关修改；未将并行修改纳入本次发布。

文档 CI 在相关文件的 push/PR 上分别验证根路径和子路径，不会发布。Java `v*` Release 不触发文档部署。

依据：[GitHub 自定义域名配置](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)、[手动触发工作流](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)。
