# 项目文档索引

状态：Review
最后更新：2026-10-30

关联文档：[仓库说明](../README.md)、[协作约定](../AGENTS.md)

## 当前项目

- [文档站官方格式整理与验证](06-delivery/native-documentation-authoring.md)：原生 Markdown、首页与导航配置，旧链接和书签的兼容边界及实际验证。
- [源码学习课程完善进度](06-delivery/source-learning-progress.md)：技术选型、流程与表设计优先的学习顺序，以及首批可跟做教程、实验工具和实际验证范围。
- [源码学习目录与学习路线](../neutrino-proxy-vuepress/docs/07.源码学习/00-index.md)：面向 3 年经验开发者的 12 个专题、60 篇正文已补齐，Java 主线 56 篇，桌面端进阶 4 篇；原样源码节选与调用链已核对；首批四篇补齐逐步实验，其余练习继续完善，实测与待验证项分别说明。
- [文章写作与源码引用规范](../neutrino-proxy-vuepress/docs/07.源码学习/01-authoring.md)：项目代码节选、提交与行号、删节及教学简化标记、实验和状态记录。
- [01.01 项目全景与内网穿透边界](../neutrino-proxy-vuepress/docs/07.源码学习/01.项目导读/01-project-overview.md)：模块边界、四类 Channel、真实代码与 TCP 调用链；附可重复实验和不可达目标的实际失败记录。
- [文档站构建与部署](05-operations/documentation-site.md)：VitePress、旧链接、根/子路径、CI、GitHub Pages 自定义域名与手动发布。
- [VitePress 迁移与验收](06-delivery/vitepress-migration.md)：迁移范围、内容基线、设计与实际验证。

本仓库维护服务端、Java 命令行客户端、core 和管理后台。桌面 Rust/Tauri 项目已于 2026-10-27 完整移入独立仓库，不再从本仓库构建或发布。

- [服务端/命令行客户端发布](06-delivery/release-pipeline.md)：八份分发包、Java/管理后台构建、版本与完整性校验。
- [Linux 原生包兼容性](05-operations/linux-native-compatibility.md)：glibc 和 musl 包选择、全静态门禁、CentOS 7 和内核验收边界。
- [历史统一发版记录](99-archive/unified-release-pipeline.md)：拆分前连同桌面 App 发布的授权、产物和证据。

## 独立桌面客户端

- [仓库及 README](https://github.com/ynx-official/neutrino-proxy-client-desktop)
- [桌面文档索引](https://github.com/ynx-official/neutrino-proxy-client-desktop/blob/main/docs/README.md)
- [拆分记录](https://github.com/ynx-official/neutrino-proxy-client-desktop/blob/main/docs/06-delivery/project-extraction.md)
- [独立发布规则](https://github.com/ynx-official/neutrino-proxy-client-desktop/blob/main/docs/06-delivery/releasing.md)

原桌面方案、架构、协议兼容矩阵、已确认样图及运行截图均随项目迁入，旧 Flutter 内容已替换。两个仓库独立版本和 tag，本次未提交、推送或发布。

## 既有资料

以下保留原路径，本轮未逐项审查其时效性。

- [快速使用](快速使用.MD)
- [管理后台使用指南](管理后台使用指南.MD)
- [性能测试](性能测试.MD)
- [开发问题汇总](开发问题汇总.MD)
- [如何贡献](如何贡献.MD)
- [Channel](Channel.MD)、[Bean](Bean.MD)、[AOP](Aop.MD)
