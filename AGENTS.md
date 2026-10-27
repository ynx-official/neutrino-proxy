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
