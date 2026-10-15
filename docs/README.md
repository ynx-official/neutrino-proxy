# 项目文档索引

状态：Review  
最后更新：2026-10-15  
关联文档：[仓库说明](../README.md)、[协作约定](../AGENTS.md)

## 桌面客户端方案

本组文档包含新增 `neutrino-proxy-client-app` 的设计基线、当前实现及验证记录。技术路线与本机连接工具的范围已确认；设计文档中的完整目标、安全策略和验收预算仍按各文档标注审阅，不能把实现部分功能视为全部验收通过。

2026-10-15 已按用户新指令进入实现。当前已完成项及运行证据见[开发进展](06-delivery/client-app-development-status.md)，启动方式见[本地开发与运行](05-operations/client-app-local-development.md)。下列设计文档仍包含完整迁移目标，不能视为全部已实现。

1. [总体方案与改动规模](00-project/client-app-proposal.md)：目标、范围、已确认决策、工作量和风险。
2. [当前界面与交互](02-design/client-app-ui.md)：已确认的简约样图、顶部导航、三页交互、已确认的托盘浮层、项目 Logo 桌面适配及实际运行截图；历史色块方案已归档。
3. [架构与兼容性设计](03-architecture/client-app-architecture.md)：Rust 内核、协议、配置迁移、后台运行及权限边界。
4. [验收与验证方案](04-quality/client-app-acceptance.md)：功能、兼容性、长期运行和平台测试。
5. [分阶段实施计划](06-delivery/client-app-implementation-plan.md)：各阶段产物、依赖和完成条件。
6. [样图生成记录](02-design/client-app-mockup-prompts.md)：内置 image_gen 的实际提示词、修订及静态目视检查边界。

原始概念样图（已由当前界面设计取代，历史依据见[初稿归档](99-archive/client-app-ui-initial.md)）：[已连接主页](02-design/assets/client-app-connected.png)、[首次连接配置](02-design/assets/client-app-connection-setup.png)。用户已确认 `airtable` 风格；图片为概念设计，包含虚构示例数据。

## 发版与分发

- [统一发版构建流](06-delivery/release-pipeline.md)：`v*` tag 自动构建服务端、命令行客户端和桌面 App，产物齐备后自动公开正式 Release；无需配置 App 签名证书。含 `v2.0.3`、`v2.0.4` 的实际发布及校验记录。

## 既有资料

以下保留既有路径和内容；本次未对其时效性逐项审查。

- [快速使用](快速使用.MD)
- [管理后台使用指南](管理后台使用指南.MD)
- [性能测试](性能测试.MD)
- [开发问题汇总](开发问题汇总.MD)
- [如何贡献](如何贡献.MD)
- [Channel](Channel.MD)、[Bean](Bean.MD)、[AOP](Aop.MD)

