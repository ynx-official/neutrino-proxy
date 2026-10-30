# 项目协作约定

本文件适用于整个仓库；现有模块的具体配置和约定优先。

## 项目边界

- 本仓库维护 Neutrino Proxy 服务端、Java 命令行客户端、core、管理后台和既有部署脚本，遵循现有 Maven/Solon/Netty 工程约定。
- 2026-10-27 用户要求将 `neutrino-proxy-client-app` 完整迁到独立仓库 `neutrino-proxy-client-desktop`，并重写 README、拆分两个项目的工作流。桌面源码、测试、图标、文档和 CI 已迁出，不重新嵌套到本仓库。
- 桌面仓库：`https://github.com/ynx-official/neutrino-proxy-client-desktop`；其技术与 UI 规则位于自身 AGENTS.md。两仓库不通过本机相邻目录形成构建依赖。
- 本次拆分不改变 Java 通信逻辑、数据库或管理权限。

## 文档与验证

- 正式文档统一位于 `docs/`，维护 `docs/README.md`；标记状态、最后更新时间和关联文档。
- 不写入真实密码、License、Token、私钥或生产连接信息；区分需求、实现选择及实际运行证据，未执行不宣称通过。
- 复用已有 Maven、管理后台和 `scripts/release/` 的验证命令；按改动风险执行，不无条件重装依赖或改锁文件。

## 构建与发布

- CI 验证 Java 工程和发布脚本；发布仅包含服务端/命令行客户端的 JAR、Linux x64 glibc native、Linux x64 musl 全静态、Windows x64 native，共八份分发文件与两个校验/溯源文件。
- `v*` tag 构建全部必需产物、校验哈希后自动公开正式 GitHub Release；桌面独立发布，不等待或跨仓库触发。
- 手动 Release 可选已有 tag，默认仅构建；publish 和 skip_tests 仅在当次明确选择时生效。构建、全静态 ELF、产物齐备与哈希检查不跳过。
- 历史 v2.0.3–v2.0.7 发布授权与记录保留在 `docs/99-archive/unified-release-pipeline.md`；按次授权不延伸为后续提交、tag 或发布权限。
- 不自动提交、推送、创建 PR/tag、切换或删除分支、发布或清理工作区；保留任务外修改。

## 文档站 UI 与维护

- 源码学习课程按用户于 2026-10-30 明确的顺序组织：技术选型及作用 → 总体架构与业务流程图 → 业务表设计及关系 → 完整业务链路 → 具体技术原理 → 真实代码与实验。先交代为什么需要、解决什么问题，再引入术语、源码入口和操作步骤；没有历史依据时不编造原作者的选型动机。

- 适用范围：`neutrino-proxy-vuepress/`，目录名保留用于兼容既有路径，实际使用 VitePress。
- 2026-10-30 用户明确要求文章结构和格式尽可能遵循当前 VitePress 版本的官方约定，优先方便直接手动维护 Markdown。正文显式书写 `#` 标题，优先标准 Markdown、官方 frontmatter 和内置提示容器；不增加写文章必需的生成脚本、自定义组件或解析语法。
- 站点配置优先使用官方 `themeConfig.nav`、`themeConfig.sidebar` 等接口。课程章节组织、状态与源码溯源字段属于项目写作约定，不得冒充框架要求或扩展为普通文章的强制模板。
- 已有 `permalink` 通过官方 `rewrites` 保留地址；普通新文章可省略该字段，直接使用官方文件路由。标题、历史提示、索引和资源写在 Markdown 中，不恢复构建时的正文自动改写或全局 `$withBase`。旧标题锚点保留最小 `slugify` 兼容配置。
- 导航和分组直接维护 `neutrino-proxy-vuepress/docs/.vitepress/navigation.mjs` 中的官方配置；新增文章同时维护对应导航及 `/blog/` 索引。实际步骤和兼容边界见 `docs/05-operations/documentation-site.md`。
- Skill: `awesome-design-md`
- Source: `VoltAgent/awesome-design-md`
- Style ID: `mintlify`（用户于 2026-10-29 选择）
- Style reference: `C:/Users/Administrator/.codex/skills/awesome-design-md/references/design-md/mintlify/DESIGN.md`
- 保留现有文档、静态资源、永久链接和标题锚点；发布前运行 `npm run check` 与 `npm run test:e2e`。
- 根路径与子路径部署都需要验证。部署工作流仅手动触发，正式发布需要当次授权。
- 文档站采用 GitHub Pages + 自定义域名 `neutrino-proxy-docs.mrsunshine.cn`，正式构建使用 `DOCS_BASE=/`；手动工作流默认仅验证，首次上线前确认 Pages、DNS 与 HTTPS 已配置。
