# 文档站构建与部署

状态：Review  
最后更新：2026-10-30

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

`check` 依次执行全站 Markdown 格式检查、单元测试、生产构建、产物链接与锚点检查。只检查文章格式时运行 `npm run check:format`；使用通用 `markdownlint-cli2`，配置位于文档站根目录 `.markdownlint-cli2.jsonc`，不改变 Markdown 的编写或渲染方式。Playwright 自动启动并关闭独立预览服务器。Linux 首次安装浏览器时使用 `npx playwright install --with-deps chromium`。

开发服务启动后还需验证浏览器实际加载页面，不能只以 HTTP 200 判定正常。已有开发服务可用 `DOCS_TEST_URL=http://localhost:4173/` 运行相关 Playwright 用例。Markdown 内的 HTML 与 `<style>` 块在源文件中用空行分隔；开发模式编译测试防止样式混入模板，不再由构建层补写空行。

## 官方格式优先

2026-10-30 用户明确要求优先采用官方结构和格式，减少手动维护负担。以当前锁定版本的 [VitePress 1.6.4 路由](https://vuejs.github.io/vitepress/v1/zh/guide/routing)、[Markdown 扩展](https://vuejs.github.io/vitepress/v1/zh/guide/markdown)及[侧边栏配置](https://vuejs.github.io/vitepress/v1/zh/reference/default-theme-sidebar)为依据；不将新版文档中尚未支持的能力直接用于当前版本。

- 文章直接维护 `.md` 文件，显式书写一级标题和合理的二、三级标题；代码、列表、表格、链接与图片优先使用 Markdown，提示使用官方内置容器。普通文章不依赖生成器、自定义组件或额外解析语法。
- 官方不规定教程必须采用哪些章节名称。课程的学习问题、实验、状态和源码引用属于本项目的教学与追溯约定；不作为普通文章的必填模板。自定义 frontmatter 字段的用途须明确，不与官方配置混淆。
- 导航和分组直接维护 `.vitepress/navigation.mjs` 导出的 `nav`、`sidebar`，使用官方的 `text`、`link`、`items`、`collapsed` 配置。现有编号目录继续用于归类，不再通过扫描目录推断导航。分组标题、顺序和展开状态都可直接编辑。
- 普通新文章使用官方文件路由，无需 `permalink`。已有文章的 `permalink` 继续通过官方 `rewrites` 保留原地址；旧锚点保留 `markdown.anchor.slugify` 兼容配置。自动补标题、历史提示、文章索引、首页转换和 HTML URL 改写已移除，详见[整理记录](../06-delivery/native-documentation-authoring.md)。

### 手动新增或修改文章

1. 直接编辑已有 `.md`；新增普通页面例如 `docs/guide/first-step.md`，正文以 `# 第一步` 开头。需要描述或页面选项时再添加官方 frontmatter；`title` 可省略，由一级标题推导。
2. 新文件默认对应 `/guide/first-step.html`；`docs/guide/index.md` 对应 `/guide/`。新增内部链接按官方建议省略文件扩展名。已有重写页面仍使用其 `/pages/<id>/` 或 `/learn/<slug>/` 地址。
3. 在 `.vitepress/navigation.mjs` 对应分组添加链接。新的栏目同时增加 `nav` 和 `sidebar` 的路径前缀；已有 `/learn/` 前缀由课程分组共享。`/pages/<id>/` 是旧的不透明地址，仍需映射到所属分组。
4. 需要出现在 `/blog/` 全站索引时，编辑 `docs/@pages/archivesPage.md` 中的普通 Markdown 链接列表。索引不再隐式生成。
5. 图片优先写 `![说明](/img/example.png)` 或文件相对路径；`public/` 资源使用根路径，VitePress 自动处理 `base`。首页已有的复杂 HTML 布局在本页通过 `<script setup>` 导入官方 `withBase`，不用全局辅助函数。
6. 运行 `npm run check` 与 `npm run test:e2e`；涉及路径或资源时验证根路径和子路径。新增栏目、文章或有意修改旧文时，同步维护对应内容清单与兼容检查，不通过删除断言绕过内容丢失。

## 内容维护

- 原有 37 篇 Markdown 保留在原目录，已将标题、历史提示和资源路径整理为可直接维护的源内容；原有正文、地址与标题书签由兼容基线验证。145 个既有静态资源字节保持不变。
- 已有 `permalink` 必须保持唯一，例如 `/pages/793dcb/` 通过官方 `rewrites` 对应 `pages/793dcb/index.html`，不依赖单页应用回退。该字段是保留旧 URL 的项目约定，不是新文章的必填项。
- 保留 VuePress 标题 slug 规则，包括数字开头的 `_` 与中文标点。不要随意更改标题、permalink 或复制相同地址到另一篇文档。
- 顶部导航按文档、案例、支持、更新记录切换栏目；“文档”下拉只列“安装部署、使用须知、常见问题”三个分类，分别进入该类首篇文章。左侧仅显示当前栏目的文章，右侧显示本页标题目录。侧栏各组默认全部展开，支持手动收起；文章相对分类标题缩进，并用细竖线标识层级。
- `.vitepress/navigation.mjs` 保留原栏目与顺序，`06.关于我们/` 仍归入支持栏目。新文章的分类和顺序由该配置明确维护，不再取决于目录名或文件名前缀。
- `07.源码学习/` 使用独立的“源码学习”导航和侧栏，入口为 `/learn/`。已规划 12 个专题、60 篇课程（56 篇 Java 主线与 4 篇桌面进阶），另有目录和引用规范；课程正文初始为 Draft，逐篇完善并记录状态、日期和源码基线。目录与规范见[文档索引](../README.md)。
- 学习章节使用小写 kebab-case 文件名和 `/learn/<slug>/` 永久链接。`tests/learning.test.mjs` 检查目录覆盖、源码路径和符号、原样节选一致性；桌面源码使用独立仓库链接，本站测试与构建不读取相邻桌面工作区。扩充课程总量时同步更新目录和维护测试。
- Vdoing 配置说明通过首页页脚“历史站点资料”访问，使用独立侧栏并保留历史文档提示，不混入产品常见问题。`/blog/` 保留全文档索引。
- 侧栏保留原生独立滚动，使用浅灰细滑块、透明轨道，悬停或键盘焦点进入时加深。Chromium/WebKit 下宽 5px 并隐藏箭头，其他浏览器采用标准细滚动条回退；底部留白为 24px，加上设备安全区。默认展开和正文滚动不受影响。
- 新站提供本地中文搜索、代码复制、图片放大和明暗主题。搜索无需第三方服务。
- `tests/fixtures/legacy-site.json` 保留迁移时的原始文件与资源哈希，不覆盖历史依据。`authoring-compatibility.json` 在本次整理前从旧渲染器采集正文摘要和全部现有 ID，并记录与原始哈希的关联；测试检查正文、地址、标题和书签，允许补充原先缺少的文章总标题。
- 静态资源按字节或 CRLF/LF 规范化哈希验证，渲染正文统一空白后比较，使 Windows 与 Linux CI 一致。有意修订原文时核对内容与来源，再更新受影响的兼容基线；不能只重写哈希以掩盖非预期丢失。
- 格式检查覆盖全部文章的标题、列表、表格、代码围栏、图片说明等。中文长行、官方支持的 HTML/Vue、既有标题标点、代码中的有效空白和表格视觉填充不作强制排版；结构规则与表格单元格数量仍检查，代码节选正文不由格式工具改写。
- `utils/editFrontmatter.js` 仅保留为旧批量工具，不在新增文章、构建或 CI 的流程中使用；普通文章不需要运行它。

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
- [完整发布与线上验收](https://github.com/ynx-official/neutrino-proxy/actions/runs/40837776895) 的 `build`、`deploy`、`verify-live` 全部成功。当前发布提交为 `7672a3a7794dba7da78c5c34c78b183f8d4a303b`，实际 HTTPS 站点的 42 项 Chromium 用例最终通过：41 项首次通过，`/pages/eebea1/` 的搜索弹层等待首次超时，按既有 CI 重试配置重试后通过，日志标记为 1 flaky；不能将其描述为全部首次通过。检查覆盖 37 页、无尾斜杠入口、标题书签、搜索、代码复制、图片放大、主题及移动端。额外检查线上清单、两类真实 404、HTTP 301/308 到 HTTPS 的同路径/同查询参数跳转通过。
- [文档 CI](https://github.com/ynx-official/neutrino-proxy/actions/runs/40837749117) 根路径与子路径任务全部通过，包括根路径 Nginx 验证。
- 以新域名、根路径执行 `npm run check`：11 项测试、37 页、2,190 条链接/资源检查通过；`npm run test:e2e`：42 项 Chromium 测试通过。工作流 YAML、默认发布参数与产物 `CNAME` / `site-manifest.json` 均已检查。
- 本机公网完整测试遇到连接关闭、TLS 重置和导航超时，未记为通过；本机已确认 HTTPS 首页、线上清单与两类真实 404。上述完整线上验收以 GitHub runner 的实际成功结果为依据，没有跳过用例、放宽断言或禁用证书验证。
- 工作区同时存在其他导航相关修改；未将并行修改纳入本次发布。

文档 CI 在相关文件的 push/PR 上分别验证根路径和子路径，不会发布。Java `v*` Release 不触发文档部署。

依据：[GitHub 自定义域名配置](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)、[手动触发工作流](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)。
