# 项目协作约定

本文件适用于整个仓库；现有模块的具体配置和约定优先。

## 范围与技术路线

- 当前开发任务：新增 Windows / macOS 桌面客户端 `neutrino-proxy-client-app`，降低连接和配置成本，适合长期后台运行；2026-10-15 用户已授权开始实现至可打开且页面与样图一致。
- 已确认技术路线：Rust + Tokio 网络内核、Tauri 2 桌面宿主、Vue 3 + JavaScript 界面。
- 兼容现有客户端的通信协议、业务行为和配置含义；服务端与现有管理后台不在此次改造范围。
- 首版范围：本机连接配置、License、SSL、连接与断开、重连、状态及日志。端口映射继续使用既有管理后台。
- 先完成设计与兼容性验证方案，再实现业务代码。新客户端使用独立目录，保留 Java 客户端作为迁移验证依据。

## UI design system

- Scope: `neutrino-proxy-client-app`
- Skill: `awesome-design-md`
- Source: `VoltAgent/awesome-design-md`
- Style ID: `airtable`（用户于 2026-10-15 确认）
- Style reference: `C:/Users/Administrator/.codex/skills/awesome-design-md/references/design-md/airtable/DESIGN.md`
- 桌面工具的布局和视觉适配见 `docs/02-design/client-app-ui.md`；保留白底、深墨色文字、克制的主操作与清晰层级，不复制 Airtable 品牌标识或营销页面。

## 文档与验证

- 发版规则（用户于 2026-10-15 明确授权）：统一由 `v*` tag 触发服务端、命令行客户端和桌面 App 打包；全部必需产物验证通过后自动公开为正式 GitHub Release，不保留人工发布确认步骤。App 不配置开发者签名证书或公证；macOS 可使用无需证书的 ad-hoc 签名。发版流程本身不授予自动提交、推送或创建 tag 的权限；用户已另行授权本次提交、推送并构建 `v2.0.3`，后续版本仍按明确指令执行。

- 新增正式文档统一位于 `docs/`，同步维护 `docs/README.md`；注明状态、更新时间和关联文档。
- 需求事实、设计建议和待验证事项分别标明；性能目标不得写成实测结果。
- 文档、样图及日志示例不得包含真实密码、License、Token 或生产连接信息。
- 协议、连接生命周期、并发、配置迁移等行为使用有意义的自动化测试；Windows 与 macOS 的运行和资源占用必须分别验证。
- 未运行的测试、打包、浏览器或平台检查，不得声称通过。
- 不自动提交、推送、创建 PR、切换分支或清理工作区；保留任务外修改。
